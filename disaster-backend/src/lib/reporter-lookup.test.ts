import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lookupReporter } from "./reporter-lookup";

const directory = mkdtempSync(path.join(tmpdir(), "reporter-lookup-"));
const databasePath = path.join(directory, "fixture.sqlite");
const db = new Database(databasePath);
migrate(drizzle(db), { migrationsFolder: path.resolve(import.meta.dir, "../db/migrations") });
db.run("INSERT INTO beaches (id, name, slug) VALUES (1, 'Lampuuk', 'pantai_lampuuk')");
for (const [id, reporter, createdAt] of [
	["r1", "web:shared-browser", "2026-11-10 09:00:00"],
	["r2", "web:shared-browser", "2026-11-11 09:00:00"],
	["other", "wa:another-account", "2026-11-11 09:00:00"],
	["legacy1", null, "2026-11-10 09:00:00"],
	["legacy2", null, "2026-11-11 09:00:00"],
]) {
	db.run("INSERT INTO reports (id, reporter_id, beach_id, source, natural_signs, raw_body, created_at) VALUES (?, ?, 1, 'PWA', '[\"Wn-1\"]', '{\"private\":\"not-for-lookup\"}', ?)", [id!, reporter ?? null, createdAt!]);
}
afterAll(() => {
	db.close(true);
	unlinkSync(databasePath);
	rmdirSync(directory);
});

test("lookup returns the requested report, bounded matching history and total count", () => {
	const result = lookupReporter(db, "r1", 1)!;
	expect(result.report.reportId).toBe("r1");
	expect(result.reporterId).toBe("web:shared-browser");
	expect(result.totalReports).toBe(2);
	expect(result.reports.map((r) => r.reportId)).toEqual(["r2"]);
	expect(result.truncated).toBe(true);
	expect(result.attribution).toBe("unverified_browser");
	expect(JSON.stringify(result)).not.toContain("not-for-lookup");
	expect(lookupReporter(db, "r1")!.reports.map((r) => r.reportId)).toEqual(["r2", "r1"]);
});

test("unknown attribution never links all unknown reports; parameters cannot inject SQL", () => {
	const result = lookupReporter(db, "legacy1")!;
	expect(result.reporterId).toBeNull();
	expect(result.totalReports).toBeNull();
	expect(result.reports.map((r) => r.reportId)).toEqual(["legacy1"]);
	expect(lookupReporter(db, "' OR 1=1 --")).toBeNull();
	expect(() => lookupReporter(db, "r1", 0)).toThrow("limit");
});

test("reporter index exists and can be applied again without changing existing reports", async () => {
	const sql = await Bun.file(path.resolve(import.meta.dir, "../db/migrations/0001_fresh_black_tom.sql")).text();
	db.exec(sql);
	expect(db.query<{ name: string }, []>("PRAGMA index_list('reports')").all().some((row) => row.name === "reports_reporter_id_idx")).toBe(true);
	expect(lookupReporter(db, "r1")!.totalReports).toBe(2);
});

function cli(args: string[], file = databasePath) {
	return Bun.spawnSync([process.execPath, "src/cli/reporter.ts", ...args], {
		cwd: path.resolve(import.meta.dir, "../.."),
		env: { ...process.env, DATABASE_URL: `sqlite://${file}` },
		stdout: "pipe", stderr: "pipe",
	});
}

test("shipped CLI reads the existing SQLite file and reports missing reports clearly", () => {
	const result = cli(["r1", "--limit", "1"]);
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout.toString()).totalReports).toBe(2);
	expect(JSON.parse(result.stdout.toString()).truncated).toBe(true);
	const missing = cli(["missing"]);
	expect(missing.exitCode).toBe(1);
	expect(missing.stderr.toString()).toContain("Report not found");
	const invalid = cli(["r1", "--limit", "0"]);
	expect(invalid.exitCode).toBe(1);
	expect(invalid.stderr.toString()).toContain("limit");
	expect(lookupReporter(db, "r1")!.totalReports).toBe(2);
});

test("CLI never creates a database at a mistyped path", async () => {
	const nonexistent = path.join(directory, "does-not-exist.sqlite");
	expect(cli(["r1"], nonexistent).exitCode).toBe(1);
	expect(await Bun.file(nonexistent).exists()).toBe(false);
});
