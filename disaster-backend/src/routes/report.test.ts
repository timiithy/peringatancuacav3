import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

const mockProcessReport = mock<(beach: string, codes: string[], windowMs: number, threshold: number, observedAt: number, reportId: string) => Promise<{ triggeredCodes: string[]; codeCounts: Record<string, number> }>>();
const mockGetActiveWarning = mock<(beach: string) => Promise<unknown>>();
const mockSetActiveWarning = mock<() => Promise<void>>();
const mockGetReportTimeRange = mock<() => Promise<{ firstReportAt: number; lastReportAt: number }>>();
const mockPersistReport = mock<(input: Record<string, unknown>) => Promise<{ id: string; rawBody?: Record<string, unknown> }>>();
const mockPersistShapPrediction = mock<() => Promise<unknown>>();
const mockPersistAcknowledgement = mock<(report: { id: string }, response: Record<string, unknown>) => Promise<void>>();
const mockReassure = mock<() => Promise<unknown>>();
const mockXAdd = mock<(key: string, id: string, fields: Record<string, string>) => Promise<string>>();
const mockPublish = mock<() => Promise<number>>();
const mockGet = mock<(key: string) => Promise<string | null>>();
const mockSet = mock<(key: string, value: string, options?: unknown) => Promise<string | null>>();
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
	persistReportAcknowledgement: mockPersistAcknowledgement,
	reportMetadata: (report: { rawBody?: Record<string, unknown> }) => report.rawBody ?? {},
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
	LIVE_OBSERVATION_WINDOW_MS: 1800000,
	REPORT_THRESHOLD: 5,
	BEACH_THRESHOLDS: { pantai_lampuuk: 5, pantai_ulee_lheue: 5, pantai_depok: 5, pantai_samas: 5, pantai_lhoknga: 5 },
	ACTIVE_WARNING_TTL_SECONDS: 43200,
	REPORT_RATE_LIMIT_MAX: 15,
	REPORT_RATE_LIMIT_WINDOW_SECONDS: 60,
	OPENCLAW_WEBHOOK_TOKEN: "test-gateway-token",
	REPORTER_HMAC_SECRET: "test-reporter-secret-at-least-32-characters",
}));

import reportRoute from "./report";
import reportSubmitRoute from "./report-submit";

const app = new Hono().route("/api", reportRoute).route("/api", reportSubmitRoute);

describe("POST /api/report", () => {
	test("retries a below-threshold report without counting it twice and logs original sync delay", async () => {
		const cache = new Map<string, string>();
		mockGet.mockImplementation(async (key: string) => cache.get(key) ?? null);
		mockSet.mockImplementation(async (key: string, value: string) => { cache.set(key, value); return "OK"; });
		mockProcessReport.mockResolvedValue({ triggeredCodes: [], codeCounts: { "Wn-1": 1 } });
		mockXAdd.mockResolvedValue("0-0");
		const createdAtClient = Date.now() - 120000;
		const payload = { beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: createdAtClient, clientReportId: crypto.randomUUID(), createdAtClient };
		const request = () => app.request("/api/report", {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
		});
		try {
			const first = await (await request()).json() as Record<string, unknown>;
			const second = await (await request()).json() as Record<string, unknown>;
			expect(first.status).toBe("queued");
			expect(second.deduped).toBe(true);
			expect(second.reportId).toBe(first.reportId);
			expect(mockProcessReport).toHaveBeenCalledTimes(1);
			const events = mockXAdd.mock.calls.map((call) => JSON.parse(call[2].json!));
			expect(events.map((event) => event.status)).toEqual(["ACCEPTED_LIVE", "ACKNOWLEDGED", "QUEUED", "DEDUPED"]);
			for (const event of events) {
				expect(event.createdAtClient).toBe(createdAtClient);
				expect(event.clientReportId).toBe(payload.clientReportId);
				expect(event.syncDelayMs).toBe(event.receivedAtServer - createdAtClient);
				expect(event.syncDelayMs).toBeGreaterThanOrEqual(120000);
			}
		} finally {
			mockGet.mockReset().mockResolvedValue(null);
			mockSet.mockReset().mockResolvedValue("OK");
		}
	});
	beforeEach(() => {
		mockProcessReport.mockClear();
		mockGetActiveWarning.mockClear();
		mockSetActiveWarning.mockClear();
		mockGetReportTimeRange.mockClear();
		mockPersistReport.mockClear();
		mockPersistReport.mockResolvedValue({ id: "report-1", rawBody: {} });
		mockPersistAcknowledgement.mockReset().mockResolvedValue(undefined);
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
		mockGet.mockResolvedValue(null);
		mockSet.mockResolvedValue("OK");
	});

	test("different browser reports preserve one pseudonym, including historical receipts", async () => {
		const reporterBrowserId = crypto.randomUUID();
		for (let i = 0; i < 2; i++) {
			const res = await app.request("/api/report", {
				method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], clientReportId: crypto.randomUUID(), reporterBrowserId, observedAt: Date.now() - 3600000 }),
			});
			expect(res.status).toBe(200);
			const receipt = await res.text();
			expect(receipt).not.toContain(reporterBrowserId);
			expect(mockPersistReport.mock.calls[i]![0].reporterId).toBe(`web:${reporterBrowserId}`);
		}
		expect(mockPersistReport.mock.calls[0]![0].id).not.toBe(mockPersistReport.mock.calls[1]![0].id);
		expect(mockProcessReport).not.toHaveBeenCalled();
	});

	test("malformed browser attribution cannot be persisted or counted", async () => {
		const res = await app.request("/api/report", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ reporterBrowserId: "wa:forged", beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }),
		});
		expect(res.status).toBe(400);
		expect(mockPersistReport).not.toHaveBeenCalled();
		expect(mockProcessReport).not.toHaveBeenCalled();
	});

	test("WhatsApp attribution is authenticated on both submission endpoints", async () => {
		for (const authorization of [undefined, "Bearer incorrect-token"]) {
			const headers = { "content-type": "application/json", "x-whatsapp-sender": "628123456789@c.us", ...(authorization && { authorization }) };
			for (const channel of ["WA", "WHATSAPP"]) {
				const get = await app.request(`/api/report/submit?channel=${channel}&beach_location=pantai_lampuuk&lik_codes=Wn-1`, { headers });
				expect(get.status).toBe(401);
				const post = await app.request("/api/report", { method: "POST", headers, body: JSON.stringify({ _channel: channel, beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"] }) });
				expect(post.status).toBe(401);
			}
		}
		expect(mockPersistReport).not.toHaveBeenCalled();
	});

	test("public GET callers cannot claim the WhatsApp receipt namespace by omitting channel", async () => {
		const response = await app.request("/api/report/submit?beach_location=pantai_lampuuk&lik_codes=Wn-1&message_id=known-whatsapp-message");
		expect(response.status).toBe(401);
		expect(mockPersistReport).not.toHaveBeenCalled();
	});

	test("authenticated WhatsApp POST receipts cannot collide with public browser receipts", async () => {
		const clientReportId = crypto.randomUUID();
		const response = await app.request("/api/report", {
			method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-gateway-token", "x-whatsapp-sender": "628123456789@c.us" },
			body: JSON.stringify({ _channel: "WA", clientReportId, beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() - 3600000 }),
		});
		expect(response.status).toBe(200);
		expect(mockPersistReport.mock.calls[0]![0].id).toBe(`whatsapp-post:${clientReportId}`);
		expect(mockPersistReport.mock.calls[0]![0].reporterId).toMatch(/^wa:[0-9a-f]{64}$/);
		expect(mockGet).toHaveBeenCalledWith(`reports:dedupe:wa-post:${clientReportId}`);
	});

	test("authenticated WhatsApp sends stable account attribution without exposing it in receipts", async () => {
		const ids: unknown[] = [];
		for (const sender of ["628123456789@c.us", "628123456789@s.whatsapp.net", "628999999999@c.us", "120363406080394106@g.us"]) {
			const res = await app.request(`/api/report/submit?channel=WA&beach_location=pantai_lampuuk&lik_codes=Wn-1&observed_at=${Date.now() - 3600000}&message_id=${crypto.randomUUID()}`, {
				headers: { authorization: "Bearer test-gateway-token", "x-whatsapp-sender": sender },
			});
			expect(res.status).toBe(200);
			const receipt = await res.text();
			const saved = mockPersistReport.mock.calls.at(-1)![0];
			ids.push(saved.reporterId);
			expect(receipt).not.toContain(sender);
			if (saved.reporterId) expect(receipt).not.toContain(saved.reporterId as string);
			expect(JSON.stringify(saved.rawBody)).not.toContain(sender);
		}
		expect(ids[0]).toMatch(/^wa:[0-9a-f]{64}$/);
		expect(ids[0]).toBe(ids[1]);
		expect(ids[2]).not.toBe(ids[0]);
		expect(ids[3]).toBeNull();
	});

	test("legacy web submissions remain unattributed even with forged sender fields", async () => {
		const res = await app.request("/api/report", {
			method: "POST", headers: { "content-type": "application/json", "x-whatsapp-sender": "628123456789@c.us" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], reporterId: "wa:forged" }),
		});
		expect(res.status).toBe(200);
		expect(mockPersistReport.mock.calls[0]![0].reporterId).toBeNull();
	});

	test("archives stale reports durably without counting or changing active warnings", async () => {
		const observedAt = Date.now() - 3600000;
		const res = await app.request("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-2"], observedAt, createdAtClient: observedAt + 1000 }) });
		const body = await res.json() as Record<string, unknown>;
		expect(res.status).toBe(200);
		expect(body.status).toBe("archived");
		expect(body.disposition).toBe("ARCHIVED_STALE");
		expect(body.shouldDistribute).toBe(false);
		expect(mockPersistReport).toHaveBeenCalledTimes(1);
		expect(mockPersistAcknowledgement).toHaveBeenCalledTimes(1);
		expect(mockProcessReport).not.toHaveBeenCalled();
		expect(mockPersistShapPrediction).not.toHaveBeenCalled();
		expect(mockSetActiveWarning).not.toHaveBeenCalled();
		expect(mockPublish).not.toHaveBeenCalled();
		expect(mockPublishIotAlertForEvent).not.toHaveBeenCalled();
		expect(body.processedAtServer).toBeGreaterThanOrEqual(body.receivedAtServer as number);
	});

	test("missing or future times are acknowledged as uncertain history", async () => {
		for (const observedAt of [undefined, Date.now() + 60000]) {
			const res = await app.request("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-2"], observedAt }) });
			expect((await res.json() as Record<string, unknown>).status).toBe("time_uncertain");
		}
		expect(mockProcessReport).not.toHaveBeenCalled();
	});

	test("storage failure is retryable and cannot count or acknowledge a report", async () => {
		mockPersistReport.mockRejectedValue(new Error("database unavailable"));
		const res = await app.request("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-2"], observedAt: Date.now() }) });
		expect(res.status).toBe(500);
		expect(mockProcessReport).not.toHaveBeenCalled();
		expect(mockPersistAcknowledgement).not.toHaveBeenCalled();
	});

	test("a fresh reconfirmation is a new observation after historical archival", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: [], codeCounts: { "Wn-2": 1 } });
		const oldId = crypto.randomUUID();
		const newId = crypto.randomUUID();
		const send = (clientReportId: string, observedAt: number) => app.request("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-2"], clientReportId, observedAt }) });
		expect((await (await send(oldId, Date.now() - 3600000)).json() as Record<string, unknown>).status).toBe("archived");
		expect((await (await send(newId, Date.now())).json() as Record<string, unknown>).status).toBe("queued");
		expect(mockProcessReport).toHaveBeenCalledTimes(1);
		expect(mockPersistReport.mock.calls[0]![0].id).toBe(`web:${oldId}`);
		expect(mockPersistReport.mock.calls[1]![0].id).toBe(`web:${newId}`);
	});

	test("WhatsApp GET uses original observation time and archives missing times", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: [], codeCounts: { "Wn-2": 1 } });
		const observedAt = Date.now() - 480000;
		const res = await app.request(`/api/report/submit?beach_location=pantai_lampuuk&lik_codes=Wn-2&channel=WA&observed_at=${observedAt}&message_id=wa-fresh`, { headers: { authorization: "Bearer test-gateway-token" } });
		expect((await res.json() as Record<string, unknown>).status).toBe("queued");
		expect(mockProcessReport).toHaveBeenCalledWith("pantai_lampuuk", ["Wn-2"], 1800000, 5, observedAt, "report-1");
		mockProcessReport.mockClear();
		const missing = await app.request("/api/report/submit?beach_location=pantai_lampuuk&lik_codes=Wn-2&channel=WA&message_id=wa-missing", { headers: { authorization: "Bearer test-gateway-token" } });
		expect((await missing.json() as Record<string, unknown>).status).toBe("time_uncertain");
		expect(mockProcessReport).not.toHaveBeenCalled();
	});

	test("durable archived receipts survive replay without Redis response cache", async () => {
		const records = new Map<string, { id: string; rawBody: Record<string, unknown> }>();
		mockPersistReport.mockImplementation(async (input) => {
			const id = input.id as string;
			if (!records.has(id)) records.set(id, { id, rawBody: input.rawBody as Record<string, unknown> });
			return records.get(id)!;
		});
		mockPersistAcknowledgement.mockImplementation(async (report, response) => { records.get(report.id)!.rawBody.acknowledgement = response; });
		const path = `/api/report/submit?beach_location=pantai_lampuuk&lik_codes=Wn-2&channel=WA&observed_at=${Date.now() - 3600000}&message_id=wa-archived`;
		const first = await (await app.request(path, { headers: { authorization: "Bearer test-gateway-token" } })).json() as Record<string, unknown>;
		const again = await (await app.request(path, { headers: { authorization: "Bearer test-gateway-token" } })).json() as Record<string, unknown>;
		expect(first.status).toBe("archived");
		expect(again.deduped).toBe(true);
		expect(again.receivedAtServer).toBe(first.receivedAtServer);
		expect(mockProcessReport).not.toHaveBeenCalled();
		expect(records.size).toBe(1);
		mockPersistReport.mockReset();
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
					triggered_lik_codes: ["Wn-1"], observedAt: Date.now(),
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

	test("public alert responses and broadcasts omit browser attribution", async () => {
		primeTriggered("SIAGA");
		const restore = mockTriggeredFetch();
		const reporterBrowserId = crypto.randomUUID();
		try {
			const response = await app.request("/api/report", {
				method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], reporterBrowserId, observedAt: Date.now() }),
			});
			expect(response.status).toBe(200);
			expect(await response.text()).not.toContain(reporterBrowserId);
			expect(JSON.stringify(mockPublish.mock.calls)).not.toContain(reporterBrowserId);
			expect(JSON.stringify(mockXAdd.mock.calls)).not.toContain(reporterBrowserId);
			expect(JSON.stringify(mockPublishIotAlertForEvent.mock.calls)).not.toContain(reporterBrowserId);
			expect(mockPersistReport.mock.calls[0]![0].reporterId).toBe(`web:${reporterBrowserId}`);
		} finally {
			restore();
		}
	});

	test("public WhatsApp alerts omit sender addresses and their pseudonyms", async () => {
		primeTriggered("SIAGA");
		const restore = mockTriggeredFetch();
		const sender = "628123456789@c.us";
		try {
			const response = await app.request(`/api/report/submit?channel=WA&beach_location=pantai_lampuuk&lik_codes=Wn-1&observed_at=${Date.now()}`, {
				headers: { authorization: "Bearer test-gateway-token", "x-whatsapp-sender": sender },
			});
			expect(response.status).toBe(200);
			const receipt = await response.text();
			const reporterId = mockPersistReport.mock.calls[0]![0].reporterId as string;
			expect(reporterId).toMatch(/^wa:[0-9a-f]{64}$/);
			for (const content of [receipt, JSON.stringify(mockPublish.mock.calls), JSON.stringify(mockXAdd.mock.calls), JSON.stringify(mockPublishIotAlertForEvent.mock.calls)]) {
				expect(content).not.toContain(sender);
				expect(content).not.toContain(reporterId);
			}
		} finally {
			restore();
		}
	});

	test("returns 429 when the rate limit is exceeded", async () => {
		mockCheckRateLimit.mockResolvedValue({ allowed: false, count: 16, limit: 15 });
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
			body: JSON.stringify({ lik_codes: ["Wn-1"], observedAt: Date.now() }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("beach_location");
	});

	test("rejects invalid beach_location", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_tidak_ada", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
				lik_codes: ["Wn-1"], observedAt: Date.now(),
			}),
		});

		expect(res.status).toBe(200);
		expect(mockProcessReport).toHaveBeenCalledWith("pantai_lampuuk", ["Wn-1"], 1800000, expect.any(Number), expect.any(Number), "report-1");
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
				lik_codes: ["Wn-1"], observedAt: Date.now(),
			}),
		});

		expect(res.status).toBe(200);
		expect(mockProcessReport).toHaveBeenCalledWith("pantai_samas", ["Wn-1"], 1800000, expect.any(Number), expect.any(Number), "report-1");
	});

	test("rejects invalid clientReportId", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now(), clientReportId: "not-a-uuid" }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects invalid createdAtClient", async () => {
		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now(), createdAtClient: -100 }),
		});
		expect(res.status).toBe(400);
	});

	test("returns queued when threshold not hit", async () => {
		mockProcessReport.mockResolvedValue({ triggeredCodes: [], codeCounts: { "Wn-1": 1 } });
		mockXAdd.mockResolvedValue("0-0");

		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
					triggered_lik_codes: ["Wn-1"], observedAt: Date.now(),
				}), { status: 200, headers: { "content-type": "application/json" } });
			}
			return new Response("not found", { status: 404 });
		}) as unknown as typeof fetch;

		const res = await app.request("/api/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
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
			body: JSON.stringify({ beach_location: "pantai_lampuuk", lik_codes: ["Wn-1"], observedAt: Date.now() }),
		});

		globalThis.fetch = originalFetch;

		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.error).toContain("ML");
	});
});
