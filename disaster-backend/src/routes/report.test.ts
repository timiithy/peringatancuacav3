import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

const mockProcessReport = mock<(beach: string, codes: string[], windowMs: number, threshold: number) => Promise<{ triggeredCodes: string[]; codeCounts: Record<string, number> }>>();
const mockGetActiveWarning = mock<(beach: string) => Promise<unknown>>();
const mockSetActiveWarning = mock<() => Promise<void>>();
const mockGetReportTimeRange = mock<() => Promise<{ firstReportAt: number; lastReportAt: number }>>();
const mockPersistReport = mock<() => Promise<unknown>>();
const mockPersistShapPrediction = mock<() => Promise<unknown>>();
const mockReassure = mock<() => Promise<unknown>>();
const mockXAdd = mock<() => Promise<string>>();
const mockPublish = mock<() => Promise<number>>();
const mockGet = mock<() => Promise<string | null>>();
const mockSet = mock<() => Promise<string | null>>();
const mockDel = mock<() => Promise<number>>();
const mockPublishIotAlertForEvent = mock<() => Promise<{ published: boolean; reason?: string; topic?: string }>>();
const mockResetQueues = mock<() => Promise<void>>();
const mockSendOpenClawAlert = mock<() => Promise<void>>();
const mockCheckRateLimit = mock<() => Promise<{ allowed: boolean; count: number; limit: number }>>();

mock.module("../lib/redis", () => ({
	redis: {
		xAdd: mockXAdd,
		publish: mockPublish,
		get: mockGet,
		set: mockSet,
		del: mockDel,
	},
}));

mock.module("../lib/crowdsource", () => ({
	processReport: mockProcessReport,
	getActiveWarning: mockGetActiveWarning,
	setActiveWarning: mockSetActiveWarning,
	getReportTimeRange: mockGetReportTimeRange,
	resetQueues: mockResetQueues,
}));

mock.module("../lib/rate-limit", () => ({
	checkReportRateLimit: mockCheckRateLimit,
	getClientIp: (h: string | undefined | null) => h ?? "unknown",
}));

mock.module("../lib/bmkg", () => ({
	persistReport: mockPersistReport,
	persistShapPrediction: mockPersistShapPrediction,
}));

mock.module("../lib/reassurance", () => ({
	reassure: mockReassure,
}));

mock.module("../lib/openclaw", () => ({
	sendOpenClawAlert: mockSendOpenClawAlert,
}));

mock.module("../lib/iot-mqtt", () => ({
	publishIotAlertForEvent: mockPublishIotAlertForEvent,
}));

mock.module("../config", () => ({
	ALERTS_CHANNEL: "alerts:high",
	ALERTS_STREAM: "alerts:stream",
	ML_BASE_URL: "http://localhost:8000",
	REPORT_DEDUPE_PREFIX: "reports:dedupe",
	REPORT_SYNC_STREAM: "reports:sync",
	REPORT_WINDOW_MS: 600000,
	REPORT_THRESHOLD: 5,
	BEACH_THRESHOLDS: { pantai_lampuuk: 5, pantai_ulee_lheue: 5, pantai_depok: 5, pantai_samas: 5, pantai_lhoknga: 5 },
	ACTIVE_WARNING_TTL_SECONDS: 43200,
	REPORT_RATE_LIMIT_MAX: 15,
	REPORT_RATE_LIMIT_WINDOW_SECONDS: 60,
}));

import reportRoute from "./report";

const app = new Hono().route("/api", reportRoute);

describe("POST /api/report", () => {
	beforeEach(() => {
		mockProcessReport.mockClear();
		mockGetActiveWarning.mockClear();
		mockSetActiveWarning.mockClear();
		mockGetReportTimeRange.mockClear();
		mockPersistReport.mockClear();
		mockPersistShapPrediction.mockClear();
		mockReassure.mockClear();
		mockXAdd.mockClear();
		mockPublish.mockClear();
		mockGet.mockClear();
		mockSet.mockClear();
		mockDel.mockClear();
		mockPublishIotAlertForEvent.mockClear();
		mockPublishIotAlertForEvent.mockResolvedValue({ published: false, reason: "disabled" });
		mockResetQueues.mockClear().mockResolvedValue(undefined);
		mockSendOpenClawAlert.mockClear().mockResolvedValue(undefined);
		mockCheckRateLimit.mockClear().mockResolvedValue({ allowed: true, count: 1, limit: 15 });
	});

	function mockTriggeredFetch(community = "Actionable") {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async (url: string) => {
			if (url.includes("/predict")) {
				return new Response(JSON.stringify({
					active_warning: ["Wn-1"],
					sign_description: "Awan gelap",
					community_characteristics: community,
					action_recommendation: "Segera evakuasi",
					triggered_lik_codes: ["Wn-1"],
				}), { status: 200, headers: { "content-type": "application/json" } });
			}
			return new Response("not found", { status: 404 });
		}) as unknown as typeof fetch;
		return () => { globalThis.fetch = originalFetch; };
	}

	function primeTriggered(finalLevel: string) {
		mockProcessReport.mockResolvedValue({ triggeredCodes: ["Wn-1"], codeCounts: { "Wn-1": 5 } });
		mockGetActiveWarning.mockResolvedValue(null);
		mockGetReportTimeRange.mockResolvedValue({ firstReportAt: 1000, lastReportAt: 2000 });
		mockPersistReport.mockResolvedValue({ id: "report-1" });
		mockPersistShapPrediction.mockResolvedValue({ id: 1 });
		mockReassure.mockResolvedValue({ finalLevel, agreed: true });
		mockXAdd.mockResolvedValue("0-0");
		mockPublish.mockResolvedValue(1);
		mockSet.mockResolvedValue("OK");
	}

	test("returns 429 when the rate limit is exceeded", async () => {
		mockCheckRateLimit.mockResolvedValue({ allowed: false, count: 16, limit: 15 });
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});
		expect(res.status).toBe(429);
		expect(mockProcessReport).not.toHaveBeenCalled();
	});

	test("resets the crowdsource queue after a triggered alert", async () => {
		primeTriggered("SIAGA");
		const restore = mockTriggeredFetch();
		await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});
		restore();
		expect(mockResetQueues).toHaveBeenCalledTimes(1);
		expect(mockResetQueues).toHaveBeenCalledWith("pantai_lampuuk", ["Wn-1"]);
	});

	test("uses the fusion finalLevel as the alert riskLevel", async () => {
		primeTriggered("WASPADA");
		const restore = mockTriggeredFetch();
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});
		restore();
		const body = await res.json();
		expect(body.alertEvent.riskLevel).toBe("waspada");
	});

	test("does not broadcast WhatsApp when fusion result is NORMAL", async () => {
		primeTriggered("NORMAL");
		const restore = mockTriggeredFetch("Low Actionable");
		await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});
		restore();
		expect(mockSendOpenClawAlert).not.toHaveBeenCalled();
	});

	test("broadcasts WhatsApp when fusion result is dangerous", async () => {
		primeTriggered("SIAGA");
		const restore = mockTriggeredFetch();
		await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});
		restore();
		expect(mockSendOpenClawAlert).toHaveBeenCalledTimes(1);
	});

	test("rejects missing lik_codes", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk" }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("lik_codes");
	});

	test("rejects empty lik_codes array", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: [] }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects missing beach_location", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ lik_codes: ["Wn-1"] }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("beach_location");
	});

	test("rejects invalid beach_location", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_tidak_ada", lik_codes: ["Wn-1"] }),
		});
		expect(res.status).toBe(400);
	});

	test("binds device coordinates to the nearest beach", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: [], codeCounts: { "Wn-1": 1 } });
		mockXAdd.mockResolvedValue("0-0");

		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				beach_location: "pantai_samas",
				latitude: 5.4833,
				longitude: 95.2333,
				location_source: "device",
				lik_codes: ["Wn-1"],
			}),
		});

		expect(res.status).toBe(200);
		expect(mockProcessReport).toHaveBeenCalledWith("pantai_lampuuk", ["Wn-1"], expect.any(Number), expect.any(Number));
	});

	test("keeps manual beach selection when coordinates are also present", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: [], codeCounts: { "Wn-1": 1 } });
		mockXAdd.mockResolvedValue("0-0");

		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				beach_location: "pantai_samas",
				latitude: 5.4833,
				longitude: 95.2333,
				location_source: "manual",
				lik_codes: ["Wn-1"],
			}),
		});

		expect(res.status).toBe(200);
		expect(mockProcessReport).toHaveBeenCalledWith("pantai_samas", ["Wn-1"], expect.any(Number), expect.any(Number));
	});

	test("rejects invalid clientReportId", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], clientReportId: "not-a-uuid" }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects invalid createdAtClient", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], createdAtClient: -100 }),
		});
		expect(res.status).toBe(400);
	});

	test("returns queued when threshold not hit", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: [], codeCounts: { "Wn-1": 1 } });
		mockXAdd.mockResolvedValue("0-0");

		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.status).toBe("queued");
		expect(body.reportCounts).toBeDefined();
	});

	test("returns alert when threshold is hit", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: ["Wn-1"], codeCounts: { "Wn-1": 5 } });
		mockGetActiveWarning.mockResolvedValue(null);
		mockGetReportTimeRange.mockResolvedValue({ firstReportAt: 1000, lastReportAt: 2000 });
		mockPersistReport.mockResolvedValue({ id: "report-1" });
		mockPersistShapPrediction.mockResolvedValue({ id: 1 });
		mockReassure.mockResolvedValue({ finalLevel: "HIGH", agreed: true });
		mockXAdd.mockResolvedValue("0-0");
		mockPublish.mockResolvedValue(1);
		mockSet.mockResolvedValue("OK");

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async (url: string) => {
			if (url.includes("/predict")) {
				return new Response(JSON.stringify({
					active_warning: ["Wn-1"],
					sign_description: "Awan gelap",
					community_characteristics: "Actionable",
					action_recommendation: "Segera evakuasi",
				}), { status: 200, headers: { "content-type": "application/json" } });
			}
			return new Response("not found", { status: 404 });
		}) as unknown as typeof fetch;

		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});

		globalThis.fetch = originalFetch;

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.shouldDistribute).toBe(true);
		expect(body.alertEvent).toBeDefined();
		expect(body.alertEvent.riskLevel).toBeDefined();
		expect(body.alertEvent.reporterCount).toBe(5);
		expect(body.alertEvent.firstReportAt).toBe(1000);
		expect(body.alertEvent.lastReportAt).toBe(2000);
		expect(mockPublish).toHaveBeenCalled();
	});

	test("publishes triggered SIAGA alerts to MQTT IoT channel", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: ["Wn-1"], codeCounts: { "Wn-1": 5 } });
		mockGetActiveWarning.mockResolvedValue(null);
		mockGetReportTimeRange.mockResolvedValue({ firstReportAt: 1000, lastReportAt: 2000 });
		mockPersistReport.mockResolvedValue({ id: "report-1" });
		mockPersistShapPrediction.mockResolvedValue({ id: 1 });
		mockReassure.mockResolvedValue({ finalLevel: "SIAGA", agreed: true });
		mockXAdd.mockResolvedValue("0-0");
		mockPublish.mockResolvedValue(1);
		mockSet.mockResolvedValue("OK");
		mockPublishIotAlertForEvent.mockResolvedValue({ published: true, topic: "alert/pantai_lampuuk" });

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async (url: string) => {
			if (url.includes("/predict")) {
				return new Response(JSON.stringify({
					active_warning: ["Wn-1"],
					sign_description: "Awan gelap",
					community_characteristics: "Actionable",
					action_recommendation: "Siaga penuh",
					triggered_lik_codes: ["Wn-1"],
				}), { status: 200, headers: { "content-type": "application/json" } });
			}
			return new Response("not found", { status: 404 });
		}) as unknown as typeof fetch;

		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});

		globalThis.fetch = originalFetch;

		expect(res.status).toBe(200);
		expect(mockPublishIotAlertForEvent).toHaveBeenCalledTimes(1);
		const alertEvent = mockPublishIotAlertForEvent.mock.calls[0][0] as Record<string, unknown>;
		expect(alertEvent.beachLocation).toBe("pantai_lampuuk");
		expect((alertEvent.reassurance as Record<string, unknown>).finalLevel).toBe("SIAGA");
	});

	test("returns 502 when ML fails", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: ["Wn-1"], codeCounts: { "Wn-1": 5 } });
		mockGetActiveWarning.mockResolvedValue(null);
		mockXAdd.mockResolvedValue("0-0");

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async (url: string) => {
			if (url.includes("/predict")) {
				return new Response("Internal Server Error", { status: 500 });
			}
			return new Response("not found", { status: 404 });
		}) as unknown as typeof fetch;

		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});

		globalThis.fetch = originalFetch;

		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.error).toContain("ML");
	});
});
