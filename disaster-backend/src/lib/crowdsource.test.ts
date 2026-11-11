import { afterAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";

const sets = new Map<string, Map<string, number>>();
mock.module("./redis", () => ({ redis: {
  zAdd: async (key: string, member: { score: number; value: string }) => {
    if (!sets.has(key)) sets.set(key, new Map());
    sets.get(key)!.set(member.value, member.score);
  },
  zRemRangeByScore: async (key: string, lower: number | string, upper: number | string) => {
    const boundary = (v: number | string, score: number, min: boolean) => {
      const exclusive = String(v).startsWith("(");
      const num = v === "-inf" ? -Infinity : v === "+inf" ? Infinity : Number(String(v).replace("(", ""));
      return min ? exclusive ? score > num : score >= num : exclusive ? score < num : score <= num;
    };
    for (const [id, score] of sets.get(key) ?? []) if (boundary(lower, score, true) && boundary(upper, score, false)) sets.get(key)!.delete(id);
  },
  zCard: async (key: string) => sets.get(key)?.size ?? 0,
} }));

import { processReport, QUEUE_PREFIX } from "./crowdsource";
const now = Date.parse("2026-10-15T08:30:00+07:00");
const windowMs = 1800000;
beforeEach(() => { sets.clear(); setSystemTime(now); });
afterAll(() => setSystemTime());

describe("observation-time report counts", () => {
  test("scores by observation time and does not count retries twice", async () => {
    await processReport("pantai_lampuuk", ["Wn-1"], windowMs, 3, now - 480000, "same-report");
    const result = await processReport("pantai_lampuuk", ["Wn-1"], windowMs, 3, now - 480000, "same-report");
    expect(result.codeCounts["Wn-1"]).toBe(1);
    expect(sets.get(`${QUEUE_PREFIX}:pantai_lampuuk:wn-1`)!.get("same-report")).toBe(now - 480000);
  });
  test("expires earlier contributions instead of restarting their freshness", async () => {
    await processReport("pantai_lampuuk", ["Wn-1"], windowMs, 2, now - 29 * 60000, "old");
    setSystemTime(now + 2 * 60000);
    const result = await processReport("pantai_lampuuk", ["Wn-1"], windowMs, 2, now + 2 * 60000, "new");
    expect(result.codeCounts["Wn-1"]).toBe(1);
    expect(result.triggeredCodes).toEqual([]);
  });
  test("keeps the exact boundary but does not add stale or future observations", async () => {
    expect((await processReport("pantai_lampuuk", ["Wn-1"], windowMs, 2, now - windowMs, "boundary")).codeCounts["Wn-1"]).toBe(1);
    expect((await processReport("pantai_lampuuk", ["Wn-1"], windowMs, 2, now - windowMs - 1, "stale")).triggeredCodes).toEqual([]);
    expect((await processReport("pantai_lampuuk", ["Wn-1"], windowMs, 2, now + 1, "future")).triggeredCodes).toEqual([]);
    expect(sets.get(`${QUEUE_PREFIX}:pantai_lampuuk:wn-1`)!.size).toBe(1);
  });
});
