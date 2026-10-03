import { Hono } from "hono";
import { redis } from "../lib/redis";
import { sendOpenClawAlert } from "../lib/openclaw";
import { processReport, getActiveWarning, setActiveWarning, getReportTimeRange, resetQueues } from "../lib/crowdsource";
import { persistReport, persistShapPrediction } from "../lib/bmkg";
import { decideWarningLevel, reassure } from "../lib/reassurance";
import { publishIotAlertForEvent } from "../lib/iot-mqtt";
import {
	ALERTS_CHANNEL,
	ALERTS_STREAM,
	ML_BASE_URL,
	REPORT_SYNC_STREAM,
	REPORT_WINDOW_MS,
	REPORT_THRESHOLD,
	BEACH_THRESHOLDS,
	ACTIVE_WARNING_TTL_SECONDS,
} from "../config";
import { ALLOWED_BEACH_LOCATIONS } from "../types";
import type { MlResult } from "../types";

const route = new Hono();

route.get("/report/submit", async (c) => {
	const beachLocation = c.req.query("beach_location")?.trim().toLowerCase();
	const likCodesStr = c.req.query("lik_codes")?.trim();
	const createdAtClientRaw = c.req.query("created_at_client");
	const channel = c.req.query("channel") || "PWA";

	if (!beachLocation) {
		return c.json({ ok: false, error: "beach_location query parameter required" }, 400);
	}

	if (!ALLOWED_BEACH_LOCATIONS.includes(beachLocation as (typeof ALLOWED_BEACH_LOCATIONS)[number])) {
		return c.json(
			{ ok: false, error: `beach_location must be one of: ${ALLOWED_BEACH_LOCATIONS.join(", ")}` },
			400,
		);
	}

	if (!likCodesStr) {
		return c.json({ ok: false, error: "lik_codes query parameter required" }, 400);
	}

	const lik_codes = likCodesStr
		.split(",")
		.map((code) => code.trim())
		.filter(Boolean);

	if (lik_codes.length === 0) {
		return c.json({ ok: false, error: "lik_codes must contain at least one code" }, 400);
	}

	let createdAtClient: number | undefined;
	if (createdAtClientRaw) {
		const parsed = Number(createdAtClientRaw);
		if (Number.isFinite(parsed) && parsed > 0) {
			createdAtClient = parsed;
		}
	}

	const isWA = channel === "WA";
	const normalizedChannel = isWA ? "WHATSAPP" : channel;

	const serverTimestamp = Date.now();
	const reportId = crypto.randomUUID();
	const threshold = BEACH_THRESHOLDS[beachLocation] ?? REPORT_THRESHOLD;

	const { triggeredCodes, codeCounts } = await processReport(
		beachLocation,
		lik_codes,
		REPORT_WINDOW_MS,
		threshold,
	);

	await redis.xAdd(REPORT_SYNC_STREAM, "*", {
		json: JSON.stringify({
			status: "RECEIVED_VIA_GET",
			channel: normalizedChannel,
			beachLocation,
			lik_codes,
			createdAtClient: createdAtClient ?? null,
			receivedAtServer: serverTimestamp,
			reportId,
		}),
	});

	if (triggeredCodes.length === 0) {
		return c.json({
			ok: true,
			reportId,
			serverTimestamp,
			status: "queued",
			message: "Laporan diterima. Menunggu laporan lain untuk mencapai threshold.",
			reportCounts: codeCounts,
		});
	}

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
		return c.json(
			{ ok: false, error: "ML /predict failed", status: mlRes.status, detail },
			502,
		);
	}

	const result = (await mlRes.json()) as MlResult;
	const isMultisign = triggeredCodes.length > 1;

	let reassuranceResult: Record<string, unknown> | null = null;
	try {
		const savedReport = await persistReport({
			beachLocation,
			reporterId: null,
			source: normalizedChannel,
			naturalSigns: triggeredCodes,
			rawBody: { beach_location: beachLocation, lik_codes, createdAtClient, _channel: channel },
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
		console.error("[report-submit] SQLite persistence failed (non-blocking, alert still distributed via fail-safe level):", dbErr);
	}

	const isActionable = result.community_characteristics === "Actionable";
	// Fail safe if fusion/persistence failed: escalate actionable signs rather than
	// silently downgrading to NORMAL (which would suppress the alert and the buzzer).
	const reassuranceFinalLevel =
		(reassuranceResult?.finalLevel as string) ??
		decideWarningLevel(result.community_characteristics, "NORMAL", isMultisign).finalLevel;
	const shouldDistribute = reassuranceFinalLevel !== "NORMAL";
	const riskLevel = reassuranceFinalLevel.toLowerCase();
	const reporterCount = Object.values(codeCounts).reduce((sum, count) => sum + count, 0);
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
			clientReportId: null,
			createdAtClient: createdAtClient ?? null,
			userId: null,
			email: null,
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

	const mergedCodes = [...new Set([
		...(existingWarning?.codes ?? []),
		...result.active_warning,
	])];
	await setActiveWarning(beachLocation, mergedCodes, alertEvent.alertId, ACTIVE_WARNING_TTL_SECONDS, alertEvent);

	const alertJson = JSON.stringify(alertEvent);

	if (isWA && shouldDistribute) {
		await redis.xAdd("experiments:triggers", "*", {
			experimentId: "untagged",
			channel: normalizedChannel,
			triggeredAt: String(Date.now()),
			alertId: alertEvent.alertId,
		});
	}

	await redis.xAdd(ALERTS_STREAM, "*", { json: alertJson });

	console.log("[report-submit] publishing to Redis channel", ALERTS_CHANNEL, "channel:", normalizedChannel, "alertId:", alertEvent.alertId);
	await redis.publish(ALERTS_CHANNEL, alertJson);
	console.log("[report-submit] published OK");
	const iotResult = await publishIotAlertForEvent(alertEvent);
	if (iotResult.published) {
		console.log("[report-submit] published IoT MQTT alert", iotResult.topic);
	}

	if (isWA) {
		const riskLabel =
			alertEvent.riskLevel === "siaga" || alertEvent.riskLevel === "ekstrem"
				? "🔴 BAHAYA"
				: alertEvent.riskLevel === "waspada"
					? "🟡 WASPADA"
					: "✅ Aman";
		const alertText = [
			`⚠️ PERINGATAN — ${riskLabel} di ${beachLocation.replace(/_/g, " ")}`,
			`👥 Dilaporkan oleh ${alertEvent.reporterCount} nelayan`,
			`Tanda: ${triggeredCodes.join(", ")}`,
			`Rekomendasi: ${alertEvent.ml?.action_recommendation ?? "Tidak ada rekomendasi"}`,
			"Peringatan sedang dikirim ke semua nelayan.",
		].join("\n");
		await sendOpenClawAlert(alertText);
		console.log("[report-submit] sent WhatsApp alert broadcast");
	}

	await resetQueues(beachLocation, triggeredCodes);
	console.log("[report-submit] reset queues for", beachLocation, "codes:", triggeredCodes);

	return c.json({
		ok: true,
		reportId,
		serverTimestamp,
		status: "triggered",
		shouldDistribute,
		alertEvent,
		reportCounts: codeCounts,
	});
});

export default route;
