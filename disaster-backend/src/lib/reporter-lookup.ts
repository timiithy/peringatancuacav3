import type { Database } from "bun:sqlite";

type ReportSummary = {
	reportId: string;
	reporterId: string | null;
	source: string;
	beachLocation: string | null;
	createdAt: string;
	naturalSigns: string;
};

const SUMMARY = `SELECT r.id AS reportId, r.reporter_id AS reporterId,
	r.source, b.slug AS beachLocation, r.created_at AS createdAt,
	r.natural_signs AS naturalSigns
	FROM reports r LEFT JOIN beaches b ON b.id = r.beach_id`;

/** Query summaries only: raw request bodies can contain private source metadata. */
export function lookupReporter(db: Database, reportId: string, limit = 100) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
		throw new Error("limit must be an integer between 1 and 1000");
	}
	const report = db.query<ReportSummary, [string]>(`${SUMMARY} WHERE r.id = ?`).get(reportId);
	if (!report) return null;
	if (!report.reporterId) {
		return {
			report, reporterId: null, totalReports: null, reports: [report], truncated: false,
			attribution: "unknown",
			message: "This report has no reporter attribution. Other unattributed reports cannot be linked to it.",
		};
	}
	const total = db.query<{ count: number }, [string]>(
		"SELECT COUNT(*) AS count FROM reports WHERE reporter_id = ?",
	).get(report.reporterId)!.count;
	const reports = db.query<ReportSummary, [string, number]>(
		`${SUMMARY} WHERE r.reporter_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
	).all(report.reporterId, limit);
	return {
		report, reporterId: report.reporterId, totalReports: total, reports,
		truncated: total > reports.length,
		attribution: report.reporterId.startsWith("web:") ? "unverified_browser"
			: report.reporterId.startsWith("wa:") ? "gateway_whatsapp_account" : "legacy_identifier",
	};
}
