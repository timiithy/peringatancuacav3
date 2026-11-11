# Persistent report synchronization in the current web app

## Purpose / Big Picture

Reports submitted from the Next.js app must survive loss of connectivity and page reloads. The app must commit a report to IndexedDB (the browser's local database) before sending, preserve its ID and original creation time on retries, and show Indonesian states based on server acknowledgement. Existing server logging in Redis stream reports:sync will then measure the actual time between creation and receipt. WhatsApp ingestion and rules for delayed observations remain unchanged.

## Progress

- [x] Inspect both clients, current report contract, service worker and backend deduplication.
- [x] Read installed Next.js client-component/PWA guides and official IndexedDB transaction documentation.
- [x] Implement durable browser queue, foreground synchronization, and Indonesian status display.
- [x] Cache below-threshold responses for deduplication and keep receipt timestamps consistent.
- [x] Verify offline persistence, retries, rejection and synchronization metadata; document delayed-observation proposal.

## Surprises & Discoveries

The Stage 5 queue belongs to a separate backend-hosted test client. The Next.js service worker converts offline POST failures into JSON responses, which the previous reporting screen mistook for success. The POST backend only caches successful responses after an alert triggers, leaving below-threshold retries vulnerable to double counting. Context7 tools are not available in this session; installed Next.js documentation and official MDN/Hono documentation provide the relevant API guidance.

## Decision Log

Use a separate IndexedDB database for reports so notification preferences remain compatible. Commit before any network attempt, and keep acknowledged receipts for display while excluding them from retry selection. Run synchronization in the root client component on app open, online/focus/visibility events and a periodic timer. This provides browser-independent recovery while the app is open; it does not promise delivery while the app is closed. Serialize send loops with Web Locks when available and a shared promise within each tab. Use bounded backoff for retryable errors, retain permanent rejections for review, and never treat HTTP error JSON as success.

Keep the existing POST endpoint and its reports:sync stream. Correct below-threshold deduplication because offline replay requires it. Do not unify WhatsApp ingestion or change weather observation freshness policy without agreeing on that policy.

## Outcomes & Retrospective

Implemented save-before-send with transaction-completion checks, stable IDs/timestamps, serialized retry loops, bounded backoff, explicit acknowledgements and Indonesian states. Six browser tests pass and eighteen report-route tests pass. App-source TypeScript checking and targeted ESLint pass. Full-project type checks remain blocked by pre-existing errors in frontend/e2e/sse.spec.ts and backend scripts/tests/persistence typing. Browser storage remains subject to user deletion and browser eviction. App shell availability offline depends on the existing service worker having cached the page and assets. Synchronization runs while the app is open; background delivery while closed is not implemented.

## Context and Orientation

frontend/src/app/lapor/page.tsx gathers observations and location. frontend/src/lib/api.ts sends the JSON payload. Add frontend/src/lib/report-outbox.ts for durable local records and retry scheduling, and frontend/src/components/report-sync-status.tsx in the root layout for synchronization across navigation and status display. disaster-backend/src/routes/report.ts validates clientReportId/createdAtClient, caches acknowledgements and logs reports:sync. No changes are needed to crowdsource.ts for this delivery feature.

## Plan of Work

Define the payload separately from queue state. Save the payload once before sending and use the stored payload for every attempt. Wait for IndexedDB transaction completion before claiming a save. Require HTTP success, ok=true and a report ID before marking a record received. Show pending, sending, received and rejected messages in Indonesian. Keep failures in storage and offer retry and removal controls. Extend backend response typing to include queued acknowledgements and cache them before returning. Record receivedAtServer consistently at initial request receipt rather than completion.

## Concrete Steps

From frontend run bunx tsc --noEmit and targeted ESLint, then bunx playwright test e2e/report-sync.spec.ts. The Playwright suite starts Next.js and mocks the report endpoint, so no Redis or inference services are required. From disaster-backend run bun test src/routes/report.test.ts. Tests must prove offline saves survive reload, retries retain metadata, HTTP rejection never becomes received, and below-threshold retries avoid counting twice.

## Validation and Acceptance

Submit offline after loading the reporting page. Expect “Tersimpan di perangkat” and a waiting-for-connection message. Reload and verify the local record survives. Restore connectivity and expect “Laporan diterima server” only after a successful acknowledgement. Return 503 and verify it stays queued; return 400 and verify a rejected record remains visible. In server tests, a repeated clientReportId must return the cached queued response without calling processReport again; reports:sync must contain the original createdAtClient and measured syncDelayMs.

## Idempotence and Recovery

Reopening the app recovers pending records including attempts interrupted while sending. Retryable failures use the same clientReportId and createdAtClient. A failed local save prevents sending and preserves the form. A failed local receipt update leaves the persisted payload available for retry. Do not delete user data or reset databases during validation.

## Artifacts and Notes

See docs/delayed-observation-proposal.md for the proposed policy, separate from implemented synchronization behavior. Local validation used installed Chrome via a temporary ignored Playwright config because the Playwright Chromium download is absent. Browser tests exercised actual IndexedDB with mocked report responses; they did not require the live inference/Redis stack. App-only checking used an ignored temporary tsconfig extending frontend/tsconfig.json and excluding the existing broken E2E file.

    Browser report synchronization: 6 passed (Chrome).
    bun test src/routes/report.test.ts: 18 pass, 0 fail, 51 assertions.
    App-source tsc: exit 0.
    Targeted ESLint: exit 0.

The existing service-worker caching policy was intentionally excluded from browser queue tests. The reload recovery test restores page/asset connectivity while aborting report delivery, demonstrating persistent queue recovery independently of page caching. The separate offline/reconnect test verifies automatic replay without a manual retry.

## Interfaces and Dependencies

Use existing TypeScript, React, IndexedDB, Fetch, optional Web Locks, Bun tests and Playwright; add no dependencies. ReportPayload is the wire contract. StoredReport contains payload, local delivery state, attempt count and next retry time. submitReport accepts the already-created payload. saveReport commits first, and syncReports only sends stored records. Backend records synchronization metrics in reports:sync.

Revision 2026-10-15: initial plan for current-app reporting; delayed weather policy intentionally remains a proposal.

Revision 2026-10-15: recorded implementation, validation evidence, browser fallback and remaining pre-existing type-check limitations. The user subsequently approved the separate freshness policy; its implementation is tracked in execplan-observation-freshness.md and supersedes this initial milestone's statements that freshness is unchanged.
