import { Hono } from "hono";
import { redis } from "../lib/redis";
import { sendOpenClawAlert } from "../lib/openclaw";
import { processReport, getActiveWarning, setActiveWarning, getReportTimeRange, resetQueues } from "../lib/crowdsource";
import { persistReport, persistShapPrediction, reportMetadata, persistReportAcknowledgement } from "../lib/bmkg";
import { classifyObservation, observationMessage, type ObservationTiming } from "../lib/observation-time";
import { decideWarningLevel, reassure } from "../lib/reassurance";
import { publishIotAlertForEvent } from "../lib/iot-mqtt";
import {
	ALERTS_CHANNEL,
	ALERTS_STREAM,
	ML_BASE_URL,
	REPORT_SYNC_STREAM,
	LIVE_OBSERVATION_WINDOW_MS,
	REPORT_THRESHOLD,
	BEACH_THRESHOLDS,
	ACTIVE_WARNING_TTL_SECONDS,
} from "../config";
import { ALLOWED_BEACH_LOCATIONS } from "../types";
import type { MlResult } from "../types";
import { whatsAppReporterId } from "../lib/reporter";
import { requireGateway } from "../middleware/gatewayAuth";
import { assessSignCodes, rankedSignCodes, acceptedModelSigns, provisionalMessage, insufficientEvidenceReceipt } from "../lib/strong-wind-signs";

const route = new Hono();

route.get("/report/submit", async (c) => {
	const receivedAtServer = Date.now();
	const beachLocation = c.req.query("beach_location")?.trim().toLowerCase();
	const likCodesStr = c.req.query("lik_codes")?.trim();
	const createdAtClientRaw = c.req.query("created_at_client");
	const observedAtRaw = c.req.query("observed_at");
	const messageId = c.req.query("message_id");
	const channel = c.req.query("channel") || "PWA";
	const isWA = channel === "WA" || channel === "WHATSAPP";
	// message_id uses the WhatsApp receipt namespace, even for legacy callers.
	if (isWA || messageId !== undefined) requireGateway(c);
	// Sender attribution is accepted only through the authenticated gateway header.
	const reporterId = isWA ? whatsAppReporterId(c.req.header("x-whatsapp-sender")) : null;

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
	const signAssessment = assessSignCodes(lik_codes);
	if (!signAssessment) return c.json({ ok: false, error: "lik_codes must contain valid Wn-1 through Wn-17 codes" }, 400);

	let createdAtClient: number | undefined;
	if (createdAtClientRaw) {
		const parsed = Number(createdAtClientRaw);
		if (Number.isFinite(parsed) && parsed > 0) {
			createdAtClient = parsed;
		} else return c.json({ ok: false, error: "created_at_client must be a positive epoch timestamp" }, 400);
	}
	const observedAt = observedAtRaw === undefined ? undefined : Number(observedAtRaw);
	if (observedAt !== undefined && (!Number.isFinite(observedAt) || observedAt <= 0)) return c.json({ ok: false, error: "observed_at must be a positive epoch timestamp" }, 400);
	if (messageId !== undefined && (!messageId.trim() || messageId.length > 256)) return c.json({ ok: false, error: "invalid message_id" }, 400);

	const normalizedChannel = isWA ? "WHATSAPP" : "PWA";

	const serverTimestamp = Date.now();
	const lockKey = messageId ? `reports:wa:lock:${messageId}` : null;
	if (lockKey && await redis.set(lockKey, "1", { NX: true, EX: 60 }) !== "OK") return c.json({ ok: false, error: "Report is processing; retry shortly" }, 409);
	try {
		const timing = classifyObservation(observedAt, createdAtClient, receivedAtServer, LIVE_OBSERVATION_WINDOW_MS);
		const savedReport = await persistReport({
			id: messageId ? `whatsapp:${messageId}` : crypto.randomUUID(),
			beachLocation, reporterId, source: normalizedChannel, naturalSigns: lik_codes,
			rawBody: { beach_location: beachLocation, lik_codes, createdAtClient, observedAt, messageId, _channel: channel, timing },
		});
		const metadata = reportMetadata(savedReport);
		if (metadata.acknowledgement) {
			await redis.xAdd(REPORT_SYNC_STREAM, "*", { json: JSON.stringify({ ...(metadata.timing as ObservationTiming), status: "DEDUPED", reportId: savedReport.id, messageId: messageId ?? null, attemptReceivedAtServer: receivedAtServer }) });
			return c.json({ ...(metadata.acknowledgement as Record<string, unknown>), deduped: true });
		}
		const firstTiming = (metadata.timing ?? timing) as ObservationTiming;
		const reportId = savedReport.id;
		const acknowledge = async (response: Record<string, unknown>) => {
			const processedAtServer = Date.now();
			const message = [response.message, provisionalMessage(signAssessment.unrankedCodes)].filter(Boolean).join(" ") || undefined;
			const acknowledgement = { ...response, message, ...firstTiming, signAssessment, processedAtServer, processingDelayMs: processedAtServer - firstTiming.receivedAtServer };
			await persistReportAcknowledgement(savedReport, acknowledgement);
			await redis.xAdd(REPORT_SYNC_STREAM, "*", { json: JSON.stringify({ ...firstTiming, processedAtServer, processingDelayMs: acknowledgement.processingDelayMs, status: "ACKNOWLEDGED", inferenceStatus: response.inferenceStatus ?? null, signAssessment, reportId, messageId: messageId ?? null }) });
			return acknowledgement;
		};
		await redis.xAdd(REPORT_SYNC_STREAM, "*", { json: JSON.stringify({ ...firstTiming, status: firstTiming.disposition, reportId, messageId: messageId ?? null }) });
		if (firstTiming.disposition !== "ACCEPTED_LIVE") return c.json(await acknowledge({
			ok: true, reportId, serverTimestamp,
			status: firstTiming.disposition === "ARCHIVED_STALE" ? "archived" : "time_uncertain",
			message: observationMessage(firstTiming.disposition), shouldDistribute: false, reportCounts: {},
		}));
		if (signAssessment.rankedCodes.length === 0) {
			return c.json(await acknowledge({ ok: true, reportId, serverTimestamp, ...insufficientEvidenceReceipt() }));
		}
		const threshold = BEACH_THRESHOLDS[beachLocation] ?? REPORT_THRESHOLD;

		const { triggeredCodes, codeCounts } = await processReport(
			beachLocation,
			signAssessment.rankedCodes,
			LIVE_OBSERVATION_WINDOW_MS,
			threshold,
			firstTiming.observedAt!,
			reportId,
		);

		await redis.xAdd(REPORT_SYNC_STREAM, "*", {
			json: JSON.stringify({
				...firstTiming,
				status: "RECEIVED_VIA_GET",
				channel: normalizedChannel,
				beachLocation,
				lik_codes,
				reportId,
			}),
		});

		if (triggeredCodes.length === 0) {
			return c.json(await acknowledge({
				ok: true,
				reportId,
				serverTimestamp,
				status: "queued",
				inferenceStatus: "pending",
				message: "Laporan diterima. Menunggu laporan lain untuk mencapai threshold.",
				reportCounts: codeCounts,
			}));
		}

		const existingWarning = await getActiveWarning(beachLocation);
		const activeCodes = rankedSignCodes(existingWarning?.codes);

		const mlPayload = {
			lik_codes: triggeredCodes,
			beach_location: beachLocation,
			is_active_warning: activeCodes.length > 0,
			active_warning: activeCodes,
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

		const modelResult = (await mlRes.json()) as MlResult;
		const { validatedCodes, currentCodes, isMultisign } = acceptedModelSigns(modelResult, triggeredCodes, activeCodes);
		if (currentCodes.length === 0) {
			return c.json(await acknowledge({ ok: true, reportId, serverTimestamp, ...insufficientEvidenceReceipt() }));
		}
		const result: MlResult = { ...modelResult, triggered_lik_codes: validatedCodes, active_warning: validatedCodes };

		let reassuranceResult: Record<string, unknown> | null = null;
		try {
			const savedPrediction = await persistShapPrediction({
				reportId: savedReport.id,
				riskLevel: result.community_characteristics ?? "Unknown",
				communityCharacteristics: result.community_characteristics,
				validatedSigns: result.triggered_lik_codes ?? triggeredCodes,
				actions: result.action_recommendation ? [result.action_recommendation] : [],
				rawResponse: result as unknown as Record<string, unknown>,
			});
			if (!savedPrediction) throw new Error("Prediction was not persisted");
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
		const reporterCount = currentCodes.reduce((sum, code) => sum + (codeCounts[code] ?? 0), 0);
		const timeRange = await getReportTimeRange(beachLocation, currentCodes);

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
			...activeCodes,
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

		if (isWA && shouldDistribute) {
			const riskLabel =
				alertEvent.riskLevel === "siaga" || alertEvent.riskLevel === "ekstrem"
					? "🔴 BAHAYA"
					: alertEvent.riskLevel === "waspada"
						? "🟡 WASPADA"
						: "✅ Aman";
			const alertText = [
				`⚠️ PERINGATAN — ${riskLabel} di ${beachLocation.replace(/_/g, " ")}`,
				`👥 Dilaporkan oleh ${alertEvent.reporterCount} nelayan`,
				`Tanda: ${currentCodes.join(", ")}`,
				`Rekomendasi: ${alertEvent.ml?.action_recommendation ?? "Tidak ada rekomendasi"}`,
				"Peringatan sedang dikirim ke semua nelayan.",
			].join("\n");
			await sendOpenClawAlert(alertText);
			console.log("[report-submit] sent WhatsApp alert broadcast");
		}

		await resetQueues(beachLocation, currentCodes);
		console.log("[report-submit] reset queues for", beachLocation, "codes:", currentCodes);

		return c.json(await acknowledge({
			ok: true,
			reportId,
			serverTimestamp,
			status: "triggered",
			inferenceStatus: "evaluated",
			shouldDistribute,
			alertEvent,
			reportCounts: codeCounts,
		}));
	} finally {
		if (lockKey) await redis.del(lockKey);
	}
});

export default route;
