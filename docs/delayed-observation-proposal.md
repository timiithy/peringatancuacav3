# Approved treatment: delayed weather observations

Approved and implemented on 2026-10-15. Both existing reporting endpoints apply the shared freshness policy without merging their ingestion flows. The default live window is 30 minutes, configured with LIVE_OBSERVATION_WINDOW_MS (1800000 milliseconds). Both Docker Compose configurations pass this setting to the backend. The sections below retain the rationale behind the approved design; implementation details and operational behavior are described here first.

## Implemented behavior

The web form records observedAt when the user completes observation selection and offers “Baru saja,” “15 menit lalu,” “1 jam lalu,” or a local date/time. Both observedAt and createdAtClient are saved in the persistent browser payload and remain unchanged on retries. Existing queued payloads without observedAt are retained as TIME_UNCERTAIN rather than assumed fresh.

The POST and GET endpoints persist every valid report in SQLite before counting or inference. The existing reports.raw_body JSON contains the original payload, timing metadata and a durable acknowledgement. No database migration is required. Stable web client IDs and WhatsApp message IDs reuse the stored record and acknowledgement on replay, including after the Redis response cache expires. Redis contribution members also use the stable report ID, preventing retries before a completed acknowledgement from incrementing counts twice.

A nonnegative observation age of at most LIVE_OBSERVATION_WINDOW_MS is ACCEPTED_LIVE. An older observation is ARCHIVED_STALE. Missing observation time, any future observation/submission timestamp, or an observation after its submission time is TIME_UNCERTAIN. All non-live reports receive a successful historical acknowledgement and skip aggregation, inference, alert publication and warning renewal. The raw clock difference remains available for analysis; it is never clamped into a plausible value.

Live contributions use observedAt scores in reports:observed:v1:<beach>:<code>. This namespace deliberately excludes old arrival-time contributions. Counts remove scores older than the live window and exclude future scores. The active-count endpoint uses the same window and namespace. The legacy REPORT_WINDOW_MS setting no longer controls these live counts. Existing warning lifetime remains unchanged; history/uncertain reports do not extend it.

WhatsApp webhook payloads may include messageId, timestamp (original message creation time), and observedAt. Timestamp alone never proves observation time. Users can explicitly include waktu=2026-10-15T08:00:00+07:00 in a command. The simpler waktu=sekarang uses the original message timestamp only when the gateway supplies it; webhook arrival is never used as a fallback. Missing original time or explicit observation time yields historical/time-uncertain acknowledgement with instructions. The inactive inbound bridge polling functions remain inactive; the gateway hook must forward original metadata for this shorthand to work.

The reports:sync stream records disposition, observedAt, original receipt/creation times, observationAgeMs, syncDelayMs, clockQuality/reason and acknowledgement processing timestamps. Raw receipt metadata and final acknowledgement are persisted together with the report. Responses expose disposition and timing; the web queue treats archived/uncertain successes as received and stops retrying them. Its Indonesian receipt text explains whether a new observation is needed.

## Original problem and design rationale

Delivery and weather relevance are separate questions. A report observed at 08:00 and delivered at 10:00 is useful historical evidence, but it does not prove that the reported weather still exists at 10:00. Previously crowdsource.ts inserted Date.now() as the report score and used a default 24-hour counting window, so a late arrival could look fresh. Configured beach thresholds remain one; therefore freshness must be checked before counting even a single report.

## Approved timestamp model

Retain createdAtClient as the time the user submits and the app first saves the report. Add observedAt for the time the natural sign was actually seen. Default observedAt to the current time for a new report, with an optional simple Indonesian choice for earlier observations. Keep both values unchanged on every retry. Record receivedAtServer on first durable ingestion, plus processedAtServer for processing completion.

Compute synchronization delay as receivedAtServer minus createdAtClient, observation age as receivedAtServer minus observedAt, and processing delay as processedAtServer minus receivedAtServer. Synchronization delay includes offline waiting, request transit and retries; it is not a measurement of pure network latency. Device clock differences can distort the first two measurements. Keep the raw values for analysis, flag negative or implausible values, and do not silently replace the observation time with arrival time.

## Approved eligibility rule

Use a configurable live-observation window, initially a candidate of 30 minutes for discussion and field validation. This is an engineering starting point, not a scientifically established lifetime for every weather sign. The chosen value should be justified with local weather expertise and thesis evaluation; different signs may eventually need different windows.

Persist every valid report before deciding live eligibility, even if it will not contribute to an alert. If observation age is between zero and the configured live window, accept it for live aggregation. Use observedAt as its sorted-set score and remove contributions older than serverNow minus the live window whenever evaluating counts. This means earlier contributions also expire by their observation age, rather than only screening newly arriving reports. Do not retain the existing 24-hour aggregation window for these live counts while claiming they represent observations from the last 30 minutes. A separate 24-hour historical summary may still be useful.

If observation age exceeds the live window, store it as historical with a reason such as STALE_OBSERVATION, log delivery success, and return a successful acknowledgement that explicitly says it was archived and was not counted toward a live warning. The app can then show “Laporan diterima sebagai riwayat. Pengamatan terlalu lama untuk peringatan saat ini.” Do not retry an archived report indefinitely and do not alter its timestamp to make it eligible. To report continuing conditions, ask for a new observation and a new report ID.

For an observation timestamp in the future, flag clock uncertainty and exclude it from automatic live aggregation until it can be resolved. A configurable tolerance such as five minutes could help identify modest clock drift, but treating any future-dated observation as current requires an explicit policy; do not assume it happened at server receipt. Such a report may be retained as historical/unverified and acknowledged with “Waktu pengamatan perlu diperiksa.”

## Examples with the default 30-minute window

A sign observed at 08:00 and received at 08:08 contributes until 08:30, not until 08:38. A sign observed at 08:00 and received at 10:00 is archived and cannot trigger a new warning. If the same payload is retried at 10:05, return its existing archived acknowledgement using the same clientReportId. If the fisherman checks again at 10:05 and still sees the sign, that is a new observation and may be a new eligible report.

## WhatsApp without unified ingestion

Both endpoints call the same freshness policy independently without merging ingestion. The webhook now propagates original message timestamps, IDs and explicit observation times when supplied. A message's original timestamp is submission time, not proof of observation time unless the user explicitly states that the observation happened when composing it (waktu=sekarang). Without observation time, the report is acknowledged as uncertain history and the reply asks for a new report with a time; receipt at the webhook never makes a report fresh.

## Warning lifetime

Report freshness and active-warning expiry are distinct. The current 12-hour warning lifetime should be reviewed separately. Receiving an old report must not restart or extend a warning. Any extension should require a new eligible observation and a defined warning-lifetime policy.

## Validation and remaining limits

Automated tests cover the inclusive 30-minute boundary, one-millisecond expiry, future/missing timestamps, negative clock differences, original WhatsApp metadata, history without warning side effects, durable replay, SQLite receipt preservation, observation-time counts and expiry, and Indonesian browser acknowledgement states. The 30-minute setting is an approved engineering default, not a claim of scientific validation for every sign. Device-reported times remain unverified; the service checks consistency rather than proving clock accuracy. Atomic publication across SQLite, Redis and external delivery remains outside this change. Browser delivery while the app is closed remains unsupported.
