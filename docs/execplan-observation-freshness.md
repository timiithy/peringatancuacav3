# Apply observation freshness to both reporting channels

This living plan follows disaster-backend/.agent/PLANS.md.

## Purpose / Big Picture

The user approved a default 30-minute observation window. Reports must be persisted before aggregation or inference; stale observations become acknowledged history and uncertain timestamps do not trigger warnings. Both existing endpoints use the same time policy without combining their ingestion flows. The web form captures observation time and displays Indonesian historical/uncertain receipts.

## Progress

- [x] Inspect existing reporting routes, persistence, queue, and approved proposal.
- [x] Implement policy, persistent receipts, observation-based counting and logging.
- [x] Update web observation time and archived states; propagate WhatsApp timestamps/identity.
- [x] Test boundaries, history, retries, persistence failure, counters and browser behavior; update documentation.

## Surprises & Discoveries

Reports were only persisted after a threshold and successful inference. SQLite's existing raw_body field can hold receipt metadata and acknowledgements without destructive schema changes. Context7 is unavailable; official Drizzle/Redis docs and installed Next.js guides were consulted instead. Existing pending browser reports lack observedAt and will be treated as time-uncertain rather than assumed fresh.

## Decision Log

Use a configurable LIVE_OBSERVATION_WINDOW_MS defaulting to 1800000 and a separate Redis namespace for observation-time contributions to avoid mixing legacy arrival-time scores. Accept ages in the inclusive interval zero to window; any future observation, future client creation, missing observation time or observation after submission is uncertain. No clock tolerance silently converts future timestamps to present time. Persist timestamps, age, quality and disposition in raw_body. Stable IDs and durable acknowledgement metadata prevent replay from refreshing archived reports. Preserve active-warning TTL; archived reports never enter its code path.

WhatsApp supports explicit observedAt metadata or an ISO-8601 time in the command (waktu=2026-10-15T08:00:00+07:00). Original message timestamp supplies submission time only unless the user explicitly says waktu=sekarang, which means observation at original message composition time. This shorthand never falls back to webhook receipt time. Missing observation time is archived as uncertain with instructions to supply it. Keep GET and POST handlers separate.

## Outcomes & Retrospective

Implemented policy on both separate endpoints, persistent receipts/acknowledgements in SQLite raw_body, stable queue member identities, observation-based expiry, web capture and Indonesian historical/uncertain states, and WhatsApp explicit time/metadata forwarding. No SQL migration or reset is required; the reports field type annotations now correctly describe explicitly serialized JSON text. The 30-minute value is the approved engineering default and remains configurable in both Compose configurations; weather-specific validation is outside this change.

## Context and Orientation

disaster-backend/src/lib/crowdsource.ts maintains Redis scores. report.ts serves the web POST and report-submit.ts serves WhatsApp GET submissions. bmkg.ts persists SQLite reports through Drizzle. Add a pure observation-time.ts for classification. Existing reports.raw_body stores raw JSON as text; add metadata and the final response there rather than requiring migrations. The frontend report-outbox.ts preserves complete payloads across retries; report-sync-status.tsx presents acknowledgements.

## Plan of Work

Implement time classification and new queue scores first. Extend persistence with stable IDs, first receipt and durable acknowledgement. Adapt each route to persist before branching, return history/time-uncertain success without ML or warning side effects, and log receipt/processing timestamps. Capture an observation time in the summary UI and keep server disposition in local receipts. Extend WhatsApp webhook metadata without merging endpoints.

## Concrete Steps

Use bun test on each affected backend test file separately to avoid unrelated global mock interference. Run frontend app-only type checking and targeted ESLint, then the Playwright report-sync suite with installed Chrome if downloaded Chromium is unavailable. Do not reset Redis or SQLite to validate this feature.

## Validation and Acceptance

At fixed server time, an observation eight minutes old counts at its original time, one more than thirty minutes old is archived, and a future/missing time is uncertain. At exactly thirty minutes it remains eligible; older contributions are removed. Archived/uncertain submissions are stored, acknowledged and logged but never call inference, publish alerts or renew warnings. Replay returns the existing acknowledgement. A failed database write returns a retryable server error. Browser receipts stop retrying archived/uncertain successes and show Indonesian explanations.

## Idempotence and Recovery

Preserve existing uncommitted work. Add fields to JSON and optional payload properties; no database reset or schema migration. A stored acknowledgement is authoritative across Redis cache expiry. Stable queue member IDs prevent retry count inflation before inference succeeds. Missing observation metadata in an old local payload is retained and safely acknowledged as uncertain.

## Artifacts and Notes

Backend suites were run independently to avoid the repository's global module-mock interference. They passed: report endpoints (24), observation timing (6), aggregation/expiry (3), real in-memory SQLite receipt replay (1), WhatsApp webhook forwarding (3), existing BMKG helpers (6), and existing threshold configuration (3): 46 passing tests. The deliberate database-failure test emits the expected Hono error log while asserting a retryable HTTP 500 and no counting/acknowledgement.

All eight browser synchronization scenarios pass using installed Chrome through the ignored local Playwright config, including the two new historical/uncertain receipt cases. Frontend app-only TypeScript and targeted ESLint pass. Backend source checking remains blocked by existing errors in bmkg-fetch.ts, snapshot/prediction JSON typing in bmkg.ts, experiment-utils.ts, reassurance.ts and broadcast-morning.ts. No errors are reported in the newly added observation policy, receipt helpers, aggregation changes or modified reporting handlers.

Browser tests use actual IndexedDB with mocked HTTP acknowledgements; backend policy/handler tests and the real SQLite test provide separate coverage of server behavior. No live gateway, external weather service or deployment was required or changed.

## Interfaces and Dependencies

Use existing Hono, Drizzle SQLite, Redis, React, IndexedDB, Bun and Playwright. No new dependencies. ObservationTiming returns disposition ACCEPTED_LIVE, ARCHIVED_STALE or TIME_UNCERTAIN and reason/quality/age metadata. Responses include disposition and timestamps. report-sync-status preserves those fields locally.

Revision 2026-10-15: initial implementation plan following user approval.

Revision 2026-10-15: completed implementation and recorded validation and remaining pre-existing type-check errors.
