import { describe, expect, test } from "bun:test";
import { classifyObservation, parseMessageTimestamp } from "./observation-time";

const now = Date.parse("2026-10-15T08:30:00+07:00");
const windowMs = 30 * 60000;

describe("observation freshness", () => {
  test("includes the exact boundary and archives one millisecond beyond it", () => {
    expect(classifyObservation(now - windowMs, now, now, windowMs).disposition).toBe("ACCEPTED_LIVE");
    expect(classifyObservation(now - windowMs - 1, now, now, windowMs).disposition).toBe("ARCHIVED_STALE");
  });
  test("keeps observation age separate from synchronization delay", () => {
    const timing = classifyObservation(now - 20 * 60000, now - 8 * 60000, now, windowMs);
    expect(timing.observationAgeMs).toBe(20 * 60000);
    expect(timing.syncDelayMs).toBe(8 * 60000);
  });
  test("missing and future observation times are uncertain", () => {
    expect(classifyObservation(undefined, now, now, windowMs).reason).toBe("MISSING_OBSERVATION_TIME");
    expect(classifyObservation(now + 1, now, now, windowMs).disposition).toBe("TIME_UNCERTAIN");
  });
  test("negative clock differences remain visible and cannot become live", () => {
    const timing = classifyObservation(now - 1, now + 1000, now, windowMs);
    expect(timing.syncDelayMs).toBe(-1000);
    expect(timing.reason).toBe("FUTURE_SUBMISSION_TIME");
    expect(timing.disposition).toBe("TIME_UNCERTAIN");
  });
  test("an observation after submission is uncertain", () => {
    expect(classifyObservation(now - 100, now - 200, now, windowMs).reason).toBe("OBSERVED_AFTER_SUBMISSION");
  });
  test("WhatsApp timestamps accept epoch seconds/milliseconds and explicit time zones", () => {
    expect(parseMessageTimestamp(now / 1000)).toBe(now);
    expect(parseMessageTimestamp(String(now))).toBe(now);
    expect(parseMessageTimestamp("2026-10-15T08:30:00+07:00")).toBe(now);
    expect(parseMessageTimestamp("2026-10-15T08:30:00")).toBeUndefined();
    expect(parseMessageTimestamp("not a date")).toBeUndefined();
  });
});
