import { expect, test } from "bun:test";
import { SIGN_TRUST, assessSignCodes, acceptedModelSigns } from "./strong-wind-signs";
import type { MlResult } from "../types";

test("backend and model agree on Table B trust tiers", async () => {
	const modelFile = new URL("../../../SHAP-model-api/src/engine/sign_trust.json", import.meta.url);
	expect(SIGN_TRUST).toEqual(await Bun.file(modelFile).json());
	expect(Object.keys(SIGN_TRUST)).toHaveLength(17);
});

test("normalizes and deduplicates mixed signs while retaining unranked observations", () => {
	expect(assessSignCodes([" WN-4 ", "wn-16", "WN-4"])).toEqual({
		rankedCodes: ["Wn-4"], unrankedCodes: ["Wn-16"],
		trustTiers: { "Wn-4": "low", "Wn-16": "unranked" },
	});
});

test.each([[], [null], [4], ["WN-18"], ["WN-4", "unknown"], "WN-4"].map((input) => ({ input })))(
	"invalid codes cannot become evidence: %j", ({ input }) => {
		expect(assessSignCodes(input)).toBeNull();
	},
);

test("model filtering cannot inflate multiple-sign severity or add unsolicited codes", () => {
	const result = { triggered_lik_codes: ["WN-4", "WN-16", "WN-1"] } as MlResult;
	expect(acceptedModelSigns(result, ["Wn-4", "Wn-3"], [])).toEqual({
		validatedCodes: ["Wn-4"], currentCodes: ["Wn-4"], isMultisign: false,
	});
});

test("explicitly empty or insufficient model results never fall back to submitted signs", () => {
	for (const result of [
		{ triggered_lik_codes: [] },
		{ inference_status: "insufficient_evidence", triggered_lik_codes: ["Wn-4"] },
	]) {
		expect(acceptedModelSigns(result as MlResult, ["Wn-4"], []).currentCodes).toEqual([]);
	}
});

test("older responses without accepted-code fields preserve ranked inference", () => {
	expect(acceptedModelSigns({ active_warning: ["WN-4"] } as MlResult, ["Wn-4"], []).currentCodes).toEqual(["Wn-4"]);
});

test("a model response with no accepted signs cannot borrow the submitted evidence", () => {
	expect(acceptedModelSigns({ active_warning: [] } as unknown as MlResult, ["Wn-4"], []).currentCodes).toEqual([]);
	expect(acceptedModelSigns({} as MlResult, ["Wn-4"], []).currentCodes).toEqual([]);
});

test("multiple-sign severity requires multiple accepted current signs", () => {
	const result = { triggered_lik_codes: ["Wn-1", "Wn-4"] } as MlResult;
	expect(acceptedModelSigns(result, ["Wn-1", "Wn-4"], []).isMultisign).toBe(true);
	expect(acceptedModelSigns(result, ["Wn-1"], ["Wn-4"]).isMultisign).toBe(false);
});
