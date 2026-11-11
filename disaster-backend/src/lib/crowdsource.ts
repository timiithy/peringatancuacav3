import { redis } from "./redis";

export const QUEUE_PREFIX = "reports:observed:v1";
const WARNING_PREFIX = "warnings:active";

export type ActiveWarning = {
	codes: string[];
	triggeredAt: number;
	alertId: string;
	alertEvent?: Record<string, unknown>;
};

export async function processReport(
	beachLocation: string,
	likCodes: string[],
	windowMs: number,
	threshold: number,
	observedAt: number,
	reportId: string,
): Promise<{ triggeredCodes: string[]; codeCounts: Record<string, number> }> {
	const now = Date.now();
	const windowStart = now - windowMs;
	const triggeredCodes: string[] = [];
	const codeCounts: Record<string, number> = {};
	if (!Number.isFinite(observedAt) || observedAt > now || observedAt < windowStart) {
		return { triggeredCodes, codeCounts };
	}

	for (const code of likCodes) {
		const key = `${QUEUE_PREFIX}:${beachLocation}:${code.toLowerCase()}`;

		await redis.zAdd(key, { score: observedAt, value: reportId });
		await redis.zRemRangeByScore(key, "-inf", `(${windowStart}`);
		await redis.zRemRangeByScore(key, `(${now}`, "+inf");
		const count = await redis.zCard(key);

		codeCounts[code] = count;

		if (count >= threshold) {
			triggeredCodes.push(code);
		}
	}

	return { triggeredCodes, codeCounts };
}

export async function getReportTimeRange(
	beachLocation: string,
	codes: string[],
): Promise<{ firstReportAt: number; lastReportAt: number }> {
	let minTs = Infinity;
	let maxTs = 0;
	for (const code of codes) {
		const key = `${QUEUE_PREFIX}:${beachLocation}:${code.toLowerCase()}`;
		const earliest = await redis.zRangeWithScores(key, 0, 0);
		const latest = await redis.zRangeWithScores(key, -1, -1);
		if (earliest[0]) {
			if (earliest[0].score < minTs) minTs = earliest[0].score;
		}
		if (latest[0]) {
			if (latest[0].score > maxTs) maxTs = latest[0].score;
		}
	}
	return {
		firstReportAt: minTs === Infinity ? Date.now() : minTs,
		lastReportAt: maxTs === 0 ? Date.now() : maxTs,
	};
}

export async function resetQueues(beachLocation: string, codes: string[]): Promise<void> {
	for (const code of codes) {
		const key = `${QUEUE_PREFIX}:${beachLocation}:${code.toLowerCase()}`;
		await redis.del(key);
	}
}

export async function getActiveWarning(beachLocation: string): Promise<ActiveWarning | null> {
	const key = `${WARNING_PREFIX}:${beachLocation}`;
	const val = await redis.get(key);
	if (!val) return null;
	try {
		return JSON.parse(val) as ActiveWarning;
	} catch {
		return null;
	}
}

export async function setActiveWarning(
	beachLocation: string,
	codes: string[],
	alertId: string,
	ttlSeconds: number,
	alertEvent?: Record<string, unknown>,
): Promise<void> {
	const key = `${WARNING_PREFIX}:${beachLocation}`;
	const warning: ActiveWarning = {
		codes,
		triggeredAt: Date.now(),
		alertId,
		...(alertEvent ? { alertEvent } : {}),
	};
	await redis.set(key, JSON.stringify(warning), { EX: ttlSeconds });
}
