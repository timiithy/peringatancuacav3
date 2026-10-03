import { Hono } from "hono";
import { redis } from "../lib/redis";
import { sendOpenClawAlert } from "../lib/openclaw";
import { processReport, getActiveWarning, setActiveWarning, getReportTimeRange, resetQueues } from "../lib/crowdsource";
import { persistReport, persistShapPrediction } from "../lib/bmkg";
import { decideWarningLevel, reassure } from "../lib/reassurance";
import { publishIotAlertForEvent } from "../lib/iot-mqtt";
import { checkReportRateLimit, getClientIp } from "../lib/rate-limit";
import {
	ALERTS_CHANNEL,
	ALERTS_STREAM,
	ML_BASE_URL,
	REPORT_DEDUPE_PREFIX,
	REPORT_SYNC_STREAM,
	REPORT_WINDOW_MS,
	REPORT_THRESHOLD,
	BEACH_THRESHOLDS,
	ACTIVE_WARNING_TTL_SECONDS,
} from "../config";
import { ALLOWED_BEACH_LOCATIONS } from "../types";
import type { MlResult, PredictionInput } from "../types";

export const BEACH_DISPLAY_NAMES: Record<string, string> = {
	pantai_lampuuk: "Pantai Lampuuk",
	pantai_lhoknga: "Pantai Lhoknga",
	pantai_ulee_lheue: "Pantai Ulee Lheue",
	pantai_depok: "Pantai Depok",
	pantai_samas: "Pantai Samas",
};

const DANGER_TYPE_MAP: Record<string, string> = {
	"Wn-1": "Cuaca Ekstrem",
	"Wn-2": "Cuaca Ekstrem",
	"Wn-3": "Cuaca Ekstrem",
	"Wn-4": "Gelombang Tinggi",
	"Wn-5": "Gelombang Tinggi",
	"Wn-6": "Cuaca Ekstrem",
	"Wn-7": "Angin Kencang",
	"Wn-8": "Cuaca Buruk",
	"Wn-9": "Hujan Lebat",
	"Wn-13": "Cuaca Buruk",
};

function formatWhatsAppAlert(params: {
	beachLocation: string;
	communityCharacteristics: string;
	actionRecommendation: string;
	signDescription: string;
	reporterCount: number;
	triggeredCodes: string[];
	serverTimestamp: number;
	firstReportAt: number;
	lastReportAt: number;
	activeWarningTtlSeconds: number;
}): string {
	const {
		beachLocation,
		communityCharacteristics,
		actionRecommendation,
		signDescription,
		reporterCount,
		triggeredCodes,
		serverTimestamp,
		firstReportAt,
		lastReportAt,
		activeWarningTtlSeconds,
	} = params;

	const beachName = BEACH_DISPLAY_NAMES[beachLocation] ?? beachLocation;

	const dangerTypes = [...new Set(triggeredCodes.map((c) => DANGER_TYPE_MAP[c] ?? "Bahaya").filter(Boolean))];
	const dangerLabel = dangerTypes.length > 0 ? dangerTypes.join(" & ") : "Bahaya";

	const dateStr = new Date(serverTimestamp).toLocaleDateString("id-ID", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});

	const startStr = new Date(firstReportAt).toLocaleString("id-ID", {
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

	const endStr = new Date(lastReportAt).toLocaleString("id-ID", {
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

	const signLines = signDescription
		.split(" | ")
		.filter((s) => s.trim().length > 0)
		.map((s) => `- ${s.trim()}`);

	const riskLabel = communityCharacteristics === "Actionable" ? "Risiko Tinggi" : "Risiko Rendah";

	const lines = [
		`⚠️ *Rekomendasi Aksi Prakiraan ${dangerLabel} di ${beachName}*`,
		``,
		`📅 ${dateStr}`,
		`👥 Dilaporkan oleh ${reporterCount} nelayan`,
		`🕐 Mulai: ${startStr} | Berakhir: ${endStr}`,
		``,
		`🌊 *Tanda Alam Terdeteksi:*`,
		...signLines,
		``,
		`📋 *Rekomendasi Aksi:*`,
		`[${riskLabel}] ${actionRecommendation}`,
	];

	return lines.join("\n");
}

const route = new Hono();
const REPORT_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;
const REPORT_DEDUPE_LOCK_TTL_SECONDS = 30;
const REPORT_DEDUPE_LOCK_WAIT_MS = 2000;
const REPORT_DEDUPE_LOCK_POLL_MS = 100;
const UUID_V4_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReportResponse = {
	ok: true;
	reportId: string;
	serverTimestamp: number;
	shouldDistribute: boolean;
	alertEvent: Record<string, unknown>;
	reportCounts: Record<string, number>;
};

async function logReportSyncEvent(event: Record<string, unknown>) {
	await redis.xAdd(REPORT_SYNC_STREAM, "*", { json: JSON.stringify(event) });
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

route.post("/report", async (c) => {
	// Anonymous flood guard (no auth required): cap raw request volume per IP.
	const clientIp = getClientIp(c.req.header("x-forwarded-for"));
	const rate = await checkReportRateLimit(clientIp);
	if (!rate.allowed) {
		return c.json(
			{ ok: false, error: "Terlalu banyak laporan. Coba lagi sebentar lagi." },
			429,
		);
	}

	const jwtPayload = c.get("jwtPayload") as { sub?: unknown; email?: unknown } | undefined;
	const reporterUserId = typeof jwtPayload?.sub === "string" ? jwtPayload.sub : null;
	const reporterEmail = typeof jwtPayload?.email === "string" ? jwtPayload.email : null;

	const input = await c.req.json<PredictionInput>().catch(() => null);
	if (!input) return c.json({ ok: false, error: "Invalid JSON" }, 400);

	if (!Array.isArray(input.lik_codes) || input.lik_codes.length === 0) {
		return c.json({ ok: false, error: "lik_codes required" }, 400);
	}

	if (typeof input.beach_location !== "string" || input.beach_location.trim().length === 0) {
		return c.json({ ok: false, error: "beach_location required" }, 400);
	}
	const beachLocation = input.beach_location.trim().toLowerCase();
	if (!ALLOWED_BEACH_LOCATIONS.includes(beachLocation as (typeof ALLOWED_BEACH_LOCATIONS)[number])) {
		return c.json(
			{
				ok: false,
				error: `beach_location must be one of: ${ALLOWED_BEACH_LOCATIONS.join(", ")}`,
			},
			400,
		);
	}

	if (input.clientReportId !== undefined) {
		if (typeof input.clientReportId !== "string" || !UUID_V4_REGEX.test(input.clientReportId)) {
			return c.json({ ok: false, error: "clientReportId must be a UUID string" }, 400);
		}
	}

	if (input.createdAtClient !== undefined) {
		if (!Number.isFinite(input.createdAtClient) || input.createdAtClient <= 0) {
			return c.json({ ok: false, error: "createdAtClient must be a positive number" }, 400);
		}
	}

	const receivedAtServer = Date.now();
	const clientReportId = input.clientReportId;
	const createdAtClient = input.createdAtClient;
	const syncDelayMs = typeof createdAtClient === "number" ? receivedAtServer - createdAtClient : null;
	const dedupeKey = clientReportId ? `${REPORT_DEDUPE_PREFIX}:${clientReportId}` : null;
	const dedupeLockKey = dedupeKey ? `${dedupeKey}:lock` : null;
	let holdsDedupeLock = false;

	if (dedupeKey) {
		const existing = await redis.get(dedupeKey);
		if (existing) {
			const cached = JSON.parse(existing) as ReportResponse;
			await logReportSyncEvent({
				status: "DEDUPED",
				clientReportId,
				createdAtClient: createdAtClient ?? null,
				receivedAtServer,
				syncDelayMs,
				reportId: cached.reportId,
				alertId: cached.alertEvent.alertId,
			});
			return c.json({ ...cached, deduped: true });
		}

		const lockResult = await redis.set(dedupeLockKey!, "1", {
			NX: true,
			EX: REPORT_DEDUPE_LOCK_TTL_SECONDS,
		});
		holdsDedupeLock = lockResult === "OK";
		if (!holdsDedupeLock) {
			const deadline = Date.now() + REPORT_DEDUPE_LOCK_WAIT_MS;
			while (Date.now() < deadline) {
				const eventual = await redis.get(dedupeKey);
				if (eventual) {
					const cached = JSON.parse(eventual) as ReportResponse;
					await logReportSyncEvent({
						status: "DEDUPED",
						clientReportId,
						createdAtClient: createdAtClient ?? null,
						receivedAtServer: Date.now(),
						syncDelayMs,
						reportId: cached.reportId,
						alertId: cached.alertEvent.alertId,
					});
					return c.json({ ...cached, deduped: true });
				}
				await sleep(REPORT_DEDUPE_LOCK_POLL_MS);
			}

			return c.json(
				{ ok: false, error: "report with this clientReportId is processing, retry shortly" },
				409,
			);
		}
	}

	try {
		const serverTimestamp = Date.now();
		const reportId = crypto.randomUUID();

		const threshold = BEACH_THRESHOLDS[beachLocation] ?? REPORT_THRESHOLD;

		// Crowdsource queue: accumulate reports per (beach, code) and check threshold
		const { triggeredCodes, codeCounts } = await processReport(
			beachLocation,
			input.lik_codes,
			REPORT_WINDOW_MS,
			threshold,
		);

		if (triggeredCodes.length === 0) {
			await logReportSyncEvent({
				status: "QUEUED",
				clientReportId: clientReportId ?? null,
				createdAtClient: createdAtClient ?? null,
				receivedAtServer: Date.now(),
				syncDelayMs,
				beachLocation,
				lik_codes: input.lik_codes,
			});
			return c.json({ ok: true, reportId, serverTimestamp, status: "queued", reportCounts: codeCounts });
		}

		// Threshold hit — proceed to ML

		const existingWarning = await getActiveWarning(beachLocation);

		const mlPayload = {
			lik_codes: triggeredCodes,
			beach_location: beachLocation,
			is_active_warning: existingWarning !== null,
			active_warning: existingWarning?.codes ?? [],
		};

		const mlRes = await fetch(`${ML_BASE_URL}/predict`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(mlPayload),
		});

		if (!mlRes.ok) {
			const detail = await mlRes.text().catch(() => "");
			await logReportSyncEvent({
				status: "FAILED_ML",
				clientReportId: clientReportId ?? null,
				createdAtClient: createdAtClient ?? null,
				receivedAtServer: Date.now(),
				syncDelayMs,
				reportId,
				mlStatus: mlRes.status,
			});
			return c.json(
				{ ok: false, error: "ML /predict failed", status: mlRes.status, detail },
				502,
			);
		}

		const result = (await mlRes.json()) as MlResult;

		const isWA = input._channel === "WA";
		const channel = isWA ? "WHATSAPP" : (input._channel ?? "PWA");
		const isMultisign = triggeredCodes.length > 1;

		let reassuranceResult: Record<string, unknown> | null = null;
		try {
			const savedReport = await persistReport({
				beachLocation,
				reporterId: reporterUserId,
				source: channel,
				naturalSigns: triggeredCodes,
				rawBody: input as unknown as Record<string, unknown>,
			});
			const savedPrediction = await persistShapPrediction({
				reportId: savedReport.id,
				riskLevel: result.community_characteristics ?? "Unknown",
				communityCharacteristics: result.community_characteristics,
				validatedSigns: result.triggered_lik_codes ?? triggeredCodes,
				actions: result.action_recommendation ? [result.action_recommendation] : [],
				rawResponse: result as unknown as Record<string, unknown>,
			});
			const reassured = await reassure(savedPrediction.id, savedReport.id, {
				riskLevel: result.community_characteristics ?? "Unknown",
				communityCharacteristics: result.community_characteristics,
				validatedSigns: result.triggered_lik_codes ?? triggeredCodes,
				actions: result.action_recommendation ? [result.action_recommendation] : [],
				rawResponse: result as unknown as Record<string, unknown>,
			}, beachLocation, isMultisign);
			reassuranceResult = reassured as unknown as Record<string, unknown>;
		} catch (dbErr) {
			console.error("[report] SQLite persistence failed (non-blocking, alert still distributed via fail-safe level):", dbErr);
		}

		const isActionable = result.community_characteristics === "Actionable";
		// Prefer the SHAP+BMKG fusion result. If persistence/fusion failed (reassurance
		// is null), fail safe by escalating actionable signs rather than silently
		// downgrading to NORMAL (which would suppress the alert and the buzzer).
		const reassuranceFinalLevel =
			(reassuranceResult?.finalLevel as string) ??
			decideWarningLevel(result.community_characteristics, "NORMAL", isMultisign).finalLevel;
		const shouldDistribute = reassuranceFinalLevel !== "NORMAL";
		const riskLevel = reassuranceFinalLevel.toLowerCase();

		const reporterCount = Object.values(codeCounts).reduce((sum, c) => sum + c, 0);

		const timeRange = await getReportTimeRange(beachLocation, triggeredCodes);

		const alertEvent = {
			eventType: "DISASTER_ALERT",
			alertId: crypto.randomUUID(),
			reportId,
			serverTimestamp,
			beachLocation,
			riskLevel,
			reporterCount,
			firstReportAt: timeRange.firstReportAt,
			lastReportAt: timeRange.lastReportAt,
			client: {
				clientReportId: clientReportId ?? null,
				createdAtClient: createdAtClient ?? null,
				userId: reporterUserId,
				email: reporterEmail,
			},
			decision: {
				community_characteristics: result.community_characteristics,
				is_multisign: isMultisign,
				is_actionable: isActionable,
				final_risk_level: reassuranceFinalLevel,
				shouldDistribute,
			},
			input: mlPayload,
			ml: result,
			...(reassuranceResult && { reassurance: reassuranceResult }),
		};

		// Merge ML-returned active_warning with existing codes (union — warnings only grow until TTL)
		const mergedCodes = [...new Set([
			...(existingWarning?.codes ?? []),
			...result.active_warning,
		])];
		await setActiveWarning(beachLocation, mergedCodes, alertEvent.alertId, ACTIVE_WARNING_TTL_SECONDS, alertEvent);

		const alertJson = JSON.stringify(alertEvent);

		if (input._experimentId && typeof input._experimentId === "string") {
			await redis.xAdd("experiments:triggers", "*", {
				experimentId: input._experimentId,
				channel,
				triggeredAt: String(Date.now()),
				alertId: alertEvent.alertId,
			});
		} else if (isWA) {
			await redis.xAdd("experiments:triggers", "*", {
				experimentId: "untagged",
				channel,
				triggeredAt: String(Date.now()),
				alertId: alertEvent.alertId,
			});
		}

		await redis.xAdd(ALERTS_STREAM, "*", { json: alertJson });

		console.log("[report] publishing to Redis channel", ALERTS_CHANNEL, "channel:", channel, "alertId:", alertEvent.alertId);
		await redis.publish(ALERTS_CHANNEL, alertJson);
		console.log("[report] published OK");
		const iotResult = await publishIotAlertForEvent(alertEvent);
		if (iotResult.published) {
			console.log("[report] published IoT MQTT alert", iotResult.topic);
		}

		if (channel !== "WHATSAPP" && shouldDistribute) {
			const alertText = formatWhatsAppAlert({
				beachLocation,
				communityCharacteristics: result.community_characteristics,
				actionRecommendation: result.action_recommendation,
				signDescription: result.sign_description,
				reporterCount: Object.values(codeCounts).reduce((sum, c) => sum + c, 0),
				triggeredCodes,
				serverTimestamp,
				firstReportAt: timeRange.firstReportAt,
				lastReportAt: timeRange.lastReportAt,
				activeWarningTtlSeconds: ACTIVE_WARNING_TTL_SECONDS,
			});
			await sendOpenClawAlert(alertText);
		}

		// Reset the crowdsource queue for the triggered codes so a fresh batch of
		// reports is required before the next alert (prevents an alert storm where
		// every report past the threshold re-fires the whole pipeline for 24h).
		await resetQueues(beachLocation, triggeredCodes);

		const responsePayload: ReportResponse = {
			ok: true,
			reportId,
			serverTimestamp,
			shouldDistribute,
			alertEvent,
			reportCounts: codeCounts,
		};

		if (dedupeKey) {
			await redis.set(dedupeKey, JSON.stringify(responsePayload), { EX: REPORT_DEDUPE_TTL_SECONDS });
		}

		await logReportSyncEvent({
			status: "TRIGGERED",
			clientReportId: clientReportId ?? null,
			createdAtClient: createdAtClient ?? null,
			receivedAtServer: Date.now(),
			syncDelayMs,
			reportId,
			alertId: alertEvent.alertId,
			shouldDistribute,
			triggeredCodes,
		});

		return c.json(responsePayload);
	} finally {
		if (holdsDedupeLock && dedupeLockKey) {
			await redis.del(dedupeLockKey);
		}
	}
});

export default route;
