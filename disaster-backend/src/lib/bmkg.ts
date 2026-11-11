import { getDb, schema } from "../db";
import { getBmkgData } from "./bmkg-fetch";
import { eq, desc } from "drizzle-orm";

export type BmkgWeatherData = {
	weather: string;
	windSpeed: number | null;
	windDirection: string | null;
	temperature: number | null;
	humidity: number | null;
	weatherCode: number | null;
	weatherIcon: string | null;
	description: string | null;
	isSafe: boolean | null;
	warningText: string | null;
	fetchedAt: number;
};

export async function fetchBmkgWeather(beachSlug: string): Promise<BmkgWeatherData> {
	const data = await getBmkgData(beachSlug);
	if (!data) {
		return {
			weather: "Tidak tersedia",
			windSpeed: null,
			windDirection: null,
			temperature: null,
			humidity: null,
			weatherCode: null,
			weatherIcon: null,
			description: null,
			isSafe: null,
			warningText: null,
			fetchedAt: Date.now(),
		};
	}

	return {
		weather: data.weather,
		windSpeed: data.windSpeed,
		windDirection: data.windDirection,
		temperature: data.temperature,
		humidity: data.humidity,
		weatherCode: data.weatherCode,
		weatherIcon: data.weatherIcon,
		description: data.description,
		isSafe: data.isSafe,
		warningText: data.isSafe ? null : `${data.weather} - Angin ${data.windSpeed} km/jam`,
		fetchedAt: data.fetchedAt,
	};
}

export async function fetchBmkgWarning(beachSlug: string): Promise<string | null> {
	const data = await getBmkgData(beachSlug);
	if (!data || data.isSafe) return null;
	return `${data.weather} - Angin ${data.windSpeed} km/jam`;
}

export async function fetchAllForBeach(beachSlug: string) {
	const [weather, warning] = await Promise.all([
		fetchBmkgWeather(beachSlug),
		fetchBmkgWarning(beachSlug),
	]);

	return {
		weather,
		warning,
	};
}

export async function saveSnapshot(beachId: number, data: {
	weather: BmkgWeatherData;
	warning: string | null;
}) {
	const db = getDb();
	await db.insert(schema.bmkgSnapshots).values({
		beachId,
		weather: JSON.stringify(data.weather),
		waveForecast: JSON.stringify({ warning: data.warning }),
		warning: data.warning ? JSON.stringify({ text: data.warning }) : null,
	});
}

export async function getLatestSnapshot(beachId: number) {
	const db = getDb();
	const results = await db
		.select()
		.from(schema.bmkgSnapshots)
		.where(eq(schema.bmkgSnapshots.beachId, beachId))
		.limit(1)
		.orderBy(desc(schema.bmkgSnapshots.fetchedAt));

	return results[0] ?? null;
}

export async function getBeachBySlug(slug: string) {
	const db = getDb();
	const results = await db
		.select()
		.from(schema.beaches)
		.where(eq(schema.beaches.slug, slug))
		.limit(1);
	return results[0] ?? null;
}

export async function persistReport(data: {
	id?: string;
	beachLocation: string;
	reporterId: string | null;
	source: string;
	naturalSigns: string[];
	rawBody: Record<string, unknown>;
}) {
	const db = getDb();
	if (data.id) {
		const existing = (await db.select().from(schema.reports).where(eq(schema.reports.id, data.id)).limit(1))[0];
		if (existing) return existing;
	}
	let beach = await getBeachBySlug(data.beachLocation);
	if (!beach) {
		const inserted = await db.insert(schema.beaches).values({
			name: data.beachLocation.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
			slug: data.beachLocation,
		}).onConflictDoNothing({ target: schema.beaches.slug }).returning();
		beach = inserted[0] ?? await getBeachBySlug(data.beachLocation);
	}
	if (!beach) throw new Error("Report beach was not persisted");

	const inserted = await db.insert(schema.reports).values({
		...(data.id && { id: data.id }),
		beachId: beach.id,
		reporterId: data.reporterId,
		source: data.source,
		naturalSigns: JSON.stringify(data.naturalSigns),
		rawBody: JSON.stringify(data.rawBody),
	}).onConflictDoNothing({ target: schema.reports.id }).returning();
	const report = inserted[0] ?? (data.id ? (await db.select().from(schema.reports).where(eq(schema.reports.id, data.id)).limit(1))[0] : undefined);
	if (!report) throw new Error("Report was not persisted");
	return report;
}

export function reportMetadata(report: { rawBody: unknown }): Record<string, unknown> {
	return typeof report.rawBody === "string" ? JSON.parse(report.rawBody) : (report.rawBody as Record<string, unknown> | null) ?? {};
}

export async function persistReportAcknowledgement(report: { id: string; rawBody: unknown }, acknowledgement: Record<string, unknown>) {
	await getDb().update(schema.reports).set({
		rawBody: JSON.stringify({ ...reportMetadata(report), acknowledgement }),
	}).where(eq(schema.reports.id, report.id));
}

export async function persistShapPrediction(data: {
	reportId: string;
	riskLevel: string;
	communityCharacteristics?: string;
	validatedSigns?: string[];
	actions?: string[];
	rawResponse?: Record<string, unknown>;
}) {
	const db = getDb();
	const inserted = await db.insert(schema.shapPredictions).values({
		reportId: data.reportId,
		riskLevel: data.riskLevel,
		communityCharacteristics: data.communityCharacteristics ?? null,
		validatedSigns: data.validatedSigns ? JSON.stringify(data.validatedSigns) : null,
		actions: data.actions ? JSON.stringify(data.actions) : null,
		rawResponse: data.rawResponse ? JSON.stringify(data.rawResponse) : null,
	}).returning();
	return inserted[0];
}
