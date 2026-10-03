import { getDb } from "../db";
import { schema } from "../db";
import { fetchBmkgWeather, fetchBmkgWarning, saveSnapshot, getBeachBySlug } from "./bmkg";
import type { BmkgWeatherData } from "./bmkg";

type ShapResult = {
	riskLevel: string;
	communityCharacteristics?: string;
	validatedSigns?: string[];
	actions?: string[];
	rawResponse?: Record<string, unknown>;
};

type ReassuranceResult = {
	shapRisk: string;
	bmkgRisk: string;
	agreed: boolean;
	finalLevel: "NORMAL" | "WASPADA" | "SIAGA" | "EKSTREM";
	finalLevelNumeric: number;
	details: Record<string, unknown>;
};

export type WarningLevel = "NORMAL" | "WASPADA" | "SIAGA" | "EKSTREM";

function determineBmkgRisk(weather: { windSpeed: number | null } | null, hasWarning: boolean): string {
	if (!weather) return "UNKNOWN";

	const windSpeed = weather.windSpeed ?? 0;

	if (windSpeed >= 46 || hasWarning) return "HIGH";
	if (windSpeed >= 30) return "MEDIUM";
	return "LOW";
}

const LEVEL_MAP: Record<number, WarningLevel> = {
	0: "NORMAL",
	1: "WASPADA",
	2: "SIAGA",
	3: "EKSTREM",
};

const BMKG_LEVEL_MAP: Record<string, number> = {
	"NORMAL": 0,
	"WASPADA": 1,
	"SIAGA": 2,
	"EKSTREM": 3,
	"HIGH": 2,
	"MEDIUM": 1,
	"LOW": 0,
	"UNKNOWN": 0,
};

function getVillagerLevel(risk: string, isMultisign: boolean): number {
	const normalizedRisk = risk.toUpperCase();
	if (normalizedRisk === "ACTIONABLE") return isMultisign ? 2 : 1;
	if (normalizedRisk === "EKSTREM") return 3;
	if (normalizedRisk === "SIAGA" || normalizedRisk === "HIGH" || normalizedRisk === "UNSAFE") return 2;
	if (normalizedRisk === "WASPADA" || normalizedRisk === "MEDIUM") return 1;
	return 0;
}

export function decideWarningLevel(
	shapRisk: string,
	bmkgRisk: string,
	isMultisign = false,
): { finalLevel: WarningLevel; finalLevelNumeric: number; agreed: boolean } {
	const villagerLevel = getVillagerLevel(shapRisk, isMultisign);
	const bmkgLevel = BMKG_LEVEL_MAP[bmkgRisk.toUpperCase()] ?? 0;

	const score = Math.max(villagerLevel, bmkgLevel);

	const agreed = villagerLevel === bmkgLevel;

	return {
		finalLevel: LEVEL_MAP[score] ?? "NORMAL",
		finalLevelNumeric: score,
		agreed,
	};
}

export async function reassure(
	predictionId: number,
	reportId: string,
	shapResult: ShapResult,
	beachSlug: string,
	isMultisign = false,
): Promise<ReassuranceResult> {
	const db = getDb();

	const beach = await getBeachBySlug(beachSlug);
	const beachId = beach?.id ?? null;
	if (!beachId) {
		console.warn("[reassurance] Beach not found:", beachSlug);
	}

	const weather: BmkgWeatherData | null = await fetchBmkgWeather(beachSlug).catch(() => null);
	const warning: string | null = await fetchBmkgWarning(beachSlug).catch(() => null);

	if (beachId && weather) {
		await saveSnapshot(beachId, { weather, warning }).catch(() => {});
	}

	const shapRisk = shapResult.riskLevel.toUpperCase();
	const bmkgRisk = determineBmkgRisk(weather, !!warning);

	const { finalLevel, finalLevelNumeric, agreed } = decideWarningLevel(shapRisk, bmkgRisk, isMultisign);

	const result: ReassuranceResult = {
		shapRisk,
		bmkgRisk,
		agreed,
		finalLevel,
		finalLevelNumeric,
		details: { weather, warning },
	};

	await db.insert(schema.reassuranceResults).values({
		predictionId,
		reportId,
		shapRisk: result.shapRisk,
		bmkgRisk: result.bmkgRisk,
		agreed: result.agreed,
		finalLevel: result.finalLevel,
		details: JSON.stringify(result.details),
	});

	return result;
}
