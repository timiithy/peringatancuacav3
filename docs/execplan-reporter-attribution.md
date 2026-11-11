# Trace reports to a persistent pseudonymous reporter

This living ExecPlan follows `disaster-backend/.agent/PLANS.md`.

## Purpose / Big Picture

An administrator can take a report ID and find other submissions from the same browser installation or WhatsApp account without requiring registration or collecting a name. A pseudonym is a stable label rather than proof of a person's identity. A local, read-only command provides this lookup; public alert delivery never includes the new labels.

## Progress

- [x] (2026-11-11) Inspect ingestion, offline storage, database migrations, gateway hook, public alerts, and existing changes.
- [x] (2026-11-11) Check official Hono/Bun documentation and installed Next.js browser API guidance; Context7 tools are unavailable.
- [x] (2026-11-11) Implement browser attribution and authenticated WhatsApp attribution with persistent database indexing.
- [x] (2026-11-11) Add administrator lookup and deployment instructions.
- [x] (2026-11-11) Verify offline identity, sender separation, authentication, replay, privacy, migration, and CLI behavior: 60 backend/hook tests and 11 browser scenarios pass.

## Surprises & Discoveries

The working tree already contains observation freshness and persistent receipt changes. Preserve these changes. Both POST /api/report and GET /api/report/submit must retain their existing timing and warning behavior. The backend also serves an older browser form in public/app.js. The gateway hook currently substitutes the group chat for an absent sender. Its relay must distinguish senderId from chatId and omit unknown senders. JWT middleware exists but is not mounted, so attribution must work without enabling login.

The Drizzle generator initially failed while querying the Windows user profile inside the sandbox. Re-running the same installed generator with approved escalation succeeded and produced a migration containing only the reporter index. Bun's default SQLite close does not immediately release cached statements on Windows; the CLI and fixture tests use close(true) to finalize them. Full frontend TypeScript checking reports existing errors in e2e/sse.spec.ts; application-only checking passes. Full backend checking reports existing errors in weather helpers, scripts and old test typings, with none in the added attribution or lookup code.

## Decision Log

Decision: reuse reports.reporter_id with web:UUID and wa:HMAC-SHA256 values. Browser UUIDs are locally generated, unverified, and saved into each offline payload at creation. WhatsApp labels are computed only on the server from a personal sender address received through the authenticated relay. Rationale: no registration or personal identity database is needed. Date: 2026-11-11.

Decision: introduce separate OPENCLAW_WEBHOOK_TOKEN and REPORTER_HMAC_SECRET configuration, with missing gateway configuration failing closed for WhatsApp ingestion. Send credentials and sender addresses in request headers rather than GET URLs. Rationale: the public endpoints currently permit unauthenticated sender claims; the outbound gateway token is a different credential. Keep the HMAC secret persistent across deployments. Date: 2026-11-11.

Decision: keep missing attribution null and never infer it from an IP address, group address, or message ID. Do not backfill historical data automatically. Keep crowdsource thresholds and reporterCount unchanged in this task. Rationale: reliable evidence is more useful than fabricated attribution, and aggregation policy was explicitly deferred in the accepted proposal. Date: 2026-11-11.

Decision: require gateway authentication for GET requests supplying message_id even when channel is omitted; use whatsapp-post: receipt IDs and wa-post: cache keys for authenticated WhatsApp POST requests. Rationale: public browser submissions must not claim an authenticated channel's receipt namespace before the real sender submits. Date: 2026-11-11.

## Context and Orientation

frontend/src/lib/report-outbox.ts stores reports in IndexedDB, the browser database that survives reloads and offline operation. disaster-backend/public/app.js is the older reporting UI. disaster-backend/src/routes/report.ts handles web POST requests and report-submit.ts handles WhatsApp GET requests. openclaw-hooks/webhook-relay/handler.ts sends gateway events to openclaw-webhook.ts, which forwards report commands to the GET handler. bmkg.ts persists reports in SQLite through Drizzle. The existing reporter_id column needs an additive index, including both migration and fallback startup paths.

## Plan of Work

First add shared reporter validation and gateway authentication helpers. Browser submissions carry reporterBrowserId, a UUID separate from clientReportId; validate it and store web:UUID while legacy payloads remain unknown. Generate the browser ID once, using a browser lock when available to serialize first creation across tabs, and include it in outbox snapshots. Add the same behavior to the older browser form.

Next protect webhook ingestion and WhatsApp report routes with a shared bearer credential. Normalize personal WhatsApp addresses, reject group IDs for attribution, and compute a keyed digest using the persistent secret. The hook carries an explicit senderId and chatId and never substitutes the group as sender. Preserve sender identity across internal forwarding using a header. Verify replay never replaces the first stored reporter. Never include new reporter identifiers in acknowledgement payloads, public streams, or alert objects.

Finally add src/cli/reporter.ts and a reusable read-only lookup helper. Given a report ID, return its reporter and a bounded list of matching report summaries, total count, and whether the list is truncated. An unknown reporter returns only the requested report with an explanation, never all unattributed reports. Update Compose environment forwarding, hook documentation, and operator instructions.

## Milestones

Milestone 1 delivers stable labels in both browser entry points and server-derived WhatsApp labels behind bearer authentication. Reporter unit tests and report route tests verify same-account continuity, different-account separation, validation, receipt namespace isolation and omission from public events. Offline payloads capture their browser label once, preserving it through retries.

Milestone 2 delivers the additive database index and the read-only administrator command. Real migration, persistence and subprocess CLI tests verify that the command finds same-source history, reports truncation, preserves first attribution and never creates a database for a mistyped path.

Milestone 3 verifies browser behavior with Playwright, checks lint and application types, and documents setup in docs/reporter-attribution.md. All steps use temporary fixtures and preserve real databases and existing work. Live gateway deployment and setting runtime secrets belong to operator rollout, not repository verification.

## Concrete Steps

From disaster-backend, run each affected test file independently using bun test followed by the file path, because existing tests use module-level mocks that interfere across suites. Run the real SQLite migration and persistence tests. Run bun run reporter:lookup --help to verify the shipped CLI. Use a temporary fixture database for a subprocess CLI test, leaving real project databases unchanged.

From frontend, run targeted ESLint, TypeScript, and the Playwright report-sync suite. Browser tests should show that reports from the same browser retain their identity after reload and offline retry, while independent browser contexts get different IDs. Use the installed Chrome channel if downloaded Playwright Chromium is unavailable.

Commands verified in disaster-backend are bun test src/routes/report.test.ts, bun test src/routes/openclaw-webhook.test.ts, bun test src/lib/reporter.test.ts, bun test src/middleware/gatewayAuth.test.ts, bun test src/lib/report-persistence.test.ts, bun test src/lib/reporter-lookup.test.ts and bun test src/db/db.test.ts. From the repository root run bun test openclaw-hooks/webhook-relay/handler.test.ts. These eight isolated suites pass 60 tests in total. bun run reporter:lookup --help prints the usage without requiring a database.

From frontend, bunx --no-install eslint src/lib/reporter.ts src/lib/report-outbox.ts src/lib/types.ts e2e/report-sync.spec.ts passes. Application-only TypeScript checking uses an ignored temporary config extending the main tsconfig, including src/**/*.ts, src/**/*.tsx and next-env.d.ts and disabling incremental output; it passes. The browser suite is bunx --no-install playwright test e2e/report-sync.spec.ts. In this environment an ignored override selects the installed Chrome channel. The first browser run completed all eleven scenarios but stalled in managed server teardown; run the development server separately and omit webServer in the override for a clean test-runner exit.

## Validation and Acceptance

Two browser reports have different clientReportId values and the same reporterBrowserId. A reloaded offline report sends exactly its stored payload. An invalid browser UUID is rejected. Two authenticated reports from the same WhatsApp sender share a label; different senders in one group do not. Group-only metadata produces null attribution. Missing or incorrect relay credentials cannot submit or log WhatsApp reports. Raw sender identifiers and reporter pseudonyms are absent from public response bodies and broadcasts. SQLite replay retains first attribution. The CLI finds matching historical, queued and live reports and does not create or change databases.

## Idempotence and Recovery

Use an additive CREATE INDEX IF NOT EXISTS migration and matching fallback creation. Never reset SQLite or Redis. Old pending payloads and historical reports without attribution remain null. Retrying a report returns the existing receipt. Keep the same HMAC secret to preserve WhatsApp label continuity; changing it intentionally creates new labels for future submissions. Configure the same webhook token in the backend and the gateway hook before activating the updated relay.

## Outcomes & Retrospective

Implemented both browser entry points, authenticated gateway forwarding with sender/chat separation, server HMAC pseudonyms, indexed SQLite attribution, private read-only lookup, receipt namespace protection and rollout documentation. Sixty backend and hook tests pass; all eleven browser scenarios pass with a clean runner exit (26.6 seconds). Application-only frontend TypeScript, targeted lint and whitespace checks allowing Windows CRLF line endings pass. No deployment or changes to existing runtime secrets are included. Existing full-project type-check errors are recorded separately from this feature's checks.

## Artifacts and Notes

Framework references consulted: https://hono.dev/docs/middleware/builtin/bearer-auth and https://bun.sh/docs/runtime/sqlite. Installed Next.js guidance confirms browser APIs belong in client event handling. No new dependency is required.

## Interfaces and Dependencies

Use existing Hono, Bun, node:crypto, Drizzle SQLite, IndexedDB, and Playwright. reporterBrowserId is optional on wire payloads for compatibility. reports.reporterId remains string or null. OPENCLAW_WEBHOOK_TOKEN authenticates inbound relays, and REPORTER_HMAC_SECRET is a separate persistent secret used only to derive WhatsApp pseudonyms. The administrator command accesses SQLite with readonly and create:false options and binds query parameters.

Revision 2026-11-11: recorded the accepted proposal, repository findings, implementation steps, and validation criteria.

Revision 2026-11-11: completed implementation and documented passing validation, Windows test-runner teardown handling, existing type-check limitations and operator rollout requirements.
