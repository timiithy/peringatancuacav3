import { expect, test } from "bun:test";

process.env.DATABASE_URL = "sqlite://:memory:";
const { initDb, schema } = await import("../db");
const { persistReport, persistReportAcknowledgement, reportMetadata } = await import("./bmkg");
const db = initDb();

test("SQLite preserves the first observation receipt and its acknowledgement on replay", async () => {
  const input = {
    id: "web:stable-receipt", beachLocation: "pantai_lampuuk", reporterId: `web:${crypto.randomUUID()}`, source: "PWA", naturalSigns: ["Wn-1"],
    rawBody: { observedAt: 1000, timing: { receivedAtServer: 2000, disposition: "ARCHIVED_STALE" } },
  };
  const first = await persistReport(input);
  await persistReportAcknowledgement(first, { ok: true, reportId: first.id, status: "archived" });
  const replay = await persistReport({ ...input, reporterId: `web:${crypto.randomUUID()}`, rawBody: { observedAt: 9000 } });
  expect(replay.reporterId).toBe(input.reporterId);
  expect(reportMetadata(replay).observedAt).toBe(1000);
  expect(reportMetadata(replay).timing).toEqual(input.rawBody.timing);
  expect(reportMetadata(replay).acknowledgement).toEqual({ ok: true, reportId: first.id, status: "archived" });
  expect(await db.select().from(schema.reports)).toHaveLength(1);
});
