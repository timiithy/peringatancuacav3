import { describe, test, expect } from "bun:test";
import { BEACH_THRESHOLDS, REPORT_THRESHOLD } from "./config";

describe("BEACH_THRESHOLDS", () => {
	test("all supported beaches trigger after one report", () => {
		expect(BEACH_THRESHOLDS["pantai_lampuuk"]).toBe(1);
		expect(BEACH_THRESHOLDS["pantai_ulee_lheue"]).toBe(1);
	});

	test("all remaining beaches trigger after one report", () => {
		expect(BEACH_THRESHOLDS["pantai_depok"]).toBe(1);
		expect(BEACH_THRESHOLDS["pantai_samas"]).toBe(1);
		expect(BEACH_THRESHOLDS["pantai_lhoknga"]).toBe(1);
	});

	test("unknown beach falls back to REPORT_THRESHOLD", () => {
		const unknown = BEACH_THRESHOLDS["pantai_unknown"];
		expect(unknown).toBeUndefined();
		expect(REPORT_THRESHOLD).toBe(1);
	});
});
