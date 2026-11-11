import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { DATABASE_URL } from "../config";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function initDb() {
	if (_db) return _db;

	const dbPath = DATABASE_URL.replace(/^sqlite:\/\//, "");
	const dir = path.dirname(dbPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const sqlite = new Database(dbPath);
	sqlite.run("PRAGMA journal_mode = WAL");
	sqlite.run("PRAGMA foreign_keys = ON");

	_db = drizzle(sqlite, { schema });

	try {
		const migrationsDir = path.join(import.meta.dir, "migrations");
		if (fs.existsSync(migrationsDir)) {
			migrate(_db, { migrationsFolder: migrationsDir });
		} else {
			createTablesIfNotExist(sqlite);
		}
	} catch (e) {
		console.warn("[db] Migration failed, creating tables directly:", e);
		createTablesIfNotExist(sqlite);
	}

	console.log("[db] SQLite connected:", dbPath);

	return _db;
}

function createTablesIfNotExist(sqlite: Database) {
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS beaches (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			slug TEXT NOT NULL UNIQUE,
			latitude INTEGER,
			longitude INTEGER,
			community_risk_level TEXT
		);
		CREATE TABLE IF NOT EXISTS reports (
			id TEXT PRIMARY KEY,
			beach_id INTEGER REFERENCES beaches(id),
			reporter_id TEXT,
			source TEXT NOT NULL,
			natural_signs TEXT NOT NULL,
			raw_body TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE INDEX IF NOT EXISTS reports_reporter_id_idx ON reports(reporter_id);
		CREATE TABLE IF NOT EXISTS shap_predictions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			report_id TEXT REFERENCES reports(id),
			risk_level TEXT NOT NULL,
			community_characteristics TEXT,
			validated_signs TEXT,
			actions TEXT,
			raw_response TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE IF NOT EXISTS bmkg_snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			beach_id INTEGER REFERENCES beaches(id),
			weather TEXT,
			wave_forecast TEXT,
			warning TEXT,
			fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE IF NOT EXISTS reassurance_results (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			prediction_id INTEGER,
			report_id TEXT REFERENCES reports(id) UNIQUE,
			shap_risk TEXT,
			bmkg_risk TEXT,
			agreed INTEGER,
			final_level TEXT NOT NULL,
			details TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	console.log("[db] Tables ensured");
}

export function getDb() {
	if (!_db) throw new Error("Database not initialized. Call initDb() first.");
	return _db;
}

export { schema };
