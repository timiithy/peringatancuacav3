import type { MlResult } from "../types";

// Table B: categorical trust, not numeric risk weights. Kept in parity with the
// model's sign_trust.json by strong-wind-signs.test.ts (separate Docker contexts).
export const SIGN_TRUST = {
	"Wn-1": "high", "Wn-2": "high", "Wn-3": "high",
	"Wn-4": "low", "Wn-5": "low", "Wn-6": "low",
	"Wn-7": "high", "Wn-8": "high", "Wn-9": "low",
	"Wn-10": "unranked", "Wn-11": "unranked", "Wn-12": "unranked",
	"Wn-13": "low", "Wn-14": "unranked", "Wn-15": "unranked",
	"Wn-16": "unranked", "Wn-17": "unranked",
} as const;

export type SignCode = keyof typeof SIGN_TRUST;
export type SignAssessment = {
	rankedCodes: SignCode[];
	unrankedCodes: SignCode[];
	trustTiers: Partial<Record<SignCode, "high" | "low" | "unranked">>;
};

function normalizeCode(value: unknown): SignCode | null {
	if (typeof value !== "string") return null;
	const code = value.trim().toLowerCase().replace(/^wn-/, "Wn-");
	return Object.hasOwn(SIGN_TRUST, code) ? code as SignCode : null;
}

export function assessSignCodes(values: unknown): SignAssessment | null {
	if (!Array.isArray(values) || !values.length) return null;
	const codes = values.map(normalizeCode);
	if (codes.some((code) => code === null)) return null;
	const unique = [...new Set(codes as SignCode[])];
	return {
		rankedCodes: unique.filter((code) => SIGN_TRUST[code] !== "unranked"),
		unrankedCodes: unique.filter((code) => SIGN_TRUST[code] === "unranked"),
		trustTiers: Object.fromEntries(unique.map((code) => [code, SIGN_TRUST[code]])),
	};
}

export function rankedSignCodes(values: unknown): SignCode[] {
	if (!Array.isArray(values)) return [];
	return [...new Set(values.map(normalizeCode).filter(
		(code): code is SignCode => code !== null && SIGN_TRUST[code] !== "unranked",
	))];
}

export function acceptedModelSigns(result: MlResult, current: string[], active: string[]) {
	const allowed = new Set([...current, ...active]);
	// Older responses expose accepted signs through active_warning. Never treat
	// submitted signs alone as evidence; an explicit [] remains authoritative.
	const validatedCodes = result.inference_status === "insufficient_evidence" ? []
		: rankedSignCodes(result.triggered_lik_codes ?? result.active_warning).filter((code) => allowed.has(code));
	const currentCodes = current.filter((code) => validatedCodes.includes(code as SignCode));
	return { validatedCodes, currentCodes, isMultisign: currentCodes.length > 1 };
}

export function provisionalMessage(codes: string[]): string | undefined {
	return codes.length
		? `Tanda ${codes.join(", ")} dicatat sebagai pengamatan sementara. Tanda ini belum memiliki aturan peringatan yang tervalidasi dan tidak digunakan untuk menaikkan peringatan lokal.`
		: undefined;
}

export const INSUFFICIENT_EVIDENCE_MESSAGE =
	"Laporan diterima dan dicatat. Bukti belum cukup untuk inferensi tanda alam; laporan ini tidak membuat atau menaikkan peringatan lokal. Ini bukan konfirmasi bahwa kondisi aman.";

export function insufficientEvidenceReceipt() {
	return {
		status: "pending_validation" as const,
		inferenceStatus: "insufficient_evidence" as const,
		message: INSUFFICIENT_EVIDENCE_MESSAGE,
		shouldDistribute: false,
		reportCounts: {},
	};
}
