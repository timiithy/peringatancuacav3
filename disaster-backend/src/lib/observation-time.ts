export type ObservationDisposition = "ACCEPTED_LIVE" | "ARCHIVED_STALE" | "TIME_UNCERTAIN";

export type ObservationTiming = {
  observedAt: number | null;
  createdAtClient: number | null;
  receivedAtServer: number;
  syncDelayMs: number | null;
  observationAgeMs: number | null;
  disposition: ObservationDisposition;
  clockQuality: "unverified_device" | "uncertain";
  reason: string | null;
};

export function classifyObservation(observedAt: number | undefined, createdAtClient: number | undefined, receivedAtServer: number, windowMs: number): ObservationTiming {
  const timing: ObservationTiming = {
    observedAt: observedAt ?? null,
    createdAtClient: createdAtClient ?? null,
    receivedAtServer,
    syncDelayMs: createdAtClient === undefined ? null : receivedAtServer - createdAtClient,
    observationAgeMs: observedAt === undefined ? null : receivedAtServer - observedAt,
    disposition: "ACCEPTED_LIVE",
    clockQuality: "unverified_device",
    reason: null,
  };
  if (observedAt === undefined || !Number.isFinite(observedAt) || observedAt <= 0) timing.reason = "MISSING_OBSERVATION_TIME";
  else if (observedAt > receivedAtServer) timing.reason = "FUTURE_OBSERVATION_TIME";
  else if (createdAtClient !== undefined && createdAtClient > receivedAtServer) timing.reason = "FUTURE_SUBMISSION_TIME";
  else if (createdAtClient !== undefined && observedAt > createdAtClient) timing.reason = "OBSERVED_AFTER_SUBMISSION";
  if (timing.reason) {
    timing.disposition = "TIME_UNCERTAIN";
    timing.clockQuality = "uncertain";
  } else if (timing.observationAgeMs! > windowMs) {
    timing.disposition = "ARCHIVED_STALE";
    timing.reason = "STALE_OBSERVATION";
  }
  return timing;
}

export function observationMessage(disposition: ObservationDisposition): string {
  return disposition === "ARCHIVED_STALE"
    ? "Laporan diterima sebagai riwayat. Pengamatan terlalu lama untuk peringatan saat ini."
    : "Laporan diterima sebagai riwayat. Waktu pengamatan perlu diperiksa; laporan tidak dihitung untuk peringatan saat ini.";
}

export function parseMessageTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return parseMessageTimestamp(Number(value));
  // Require an explicit time zone, avoiding interpretation in the server's zone.
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
