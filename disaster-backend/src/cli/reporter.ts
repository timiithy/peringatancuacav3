import { Database } from "bun:sqlite";
import { lookupReporter } from "../lib/reporter-lookup";

const usage = "Usage: bun run reporter:lookup <report-id> [--limit 1..1000]\nReads DATABASE_URL (default sqlite://./data/disaster.db) without modifying the database.";

export function runReporterLookup(args: string[]) {
	if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
		console.log(usage);
		return;
	}
	const [reportId, option, limitRaw] = args;
	if (!reportId || reportId.startsWith("--") || (args.length !== 1 && args.length !== 3)
		|| (args.length === 3 && option !== "--limit")) throw new Error(usage);
	const limit = limitRaw === undefined ? 100 : Number(limitRaw);
	if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
		throw new Error("limit must be an integer between 1 and 1000");
	}
	const databaseUrl = process.env.DATABASE_URL ?? "sqlite://./data/disaster.db";
	const databasePath = databaseUrl.replace(/^sqlite:\/\//, "");
	if (!databasePath || databasePath === ":memory:" || /^[a-z]+:\/\//i.test(databasePath)) {
		throw new Error("DATABASE_URL must reference an existing SQLite file");
	}
	const db = new Database(databasePath, { readonly: true, create: false });
	try {
		const result = lookupReporter(db, reportId, limit);
		if (!result) throw new Error("Report not found");
		console.log(JSON.stringify(result, null, 2));
	} finally {
		db.close(true);
	}
}

if (import.meta.main) {
	try {
		runReporterLookup(Bun.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Reporter lookup failed");
		process.exitCode = 1;
	}
}
