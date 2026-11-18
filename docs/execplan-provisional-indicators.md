# Preserve provisional signs without creating unsupported warnings

This living ExecPlan follows `disaster-backend/.agent/PLANS.md`.

## Purpose / Big Picture

People can report all 17 strong-wind signs. Ten signs are ranked in the supplied
Table B; seven are unranked and have no established actions. A report containing
only unranked signs must receive a durable acknowledgement explaining that it
awaits validation, without changing active warnings or broadcasting an alert.
Mixed reports retain every observation but use ranked signs for local inference.

## Progress

- [x] (2026-11-18) Trace model, browser POST, WhatsApp GET and receipt consumers.
- [x] (2026-11-18) Consult Context7's Hono library `/honojs/hono` via its public
  documentation (no MCP tool is available); verify request testing and JSON
  response patterns against official Hono documentation.
- [x] (2026-11-18) Add ranked/unranked metadata, meaningful insufficient-evidence model output,
  and align model labels with Table B.
- [x] (2026-11-18) Guard both backend routes before aggregation and after model filtering;
  preserve complete reports and durable receipt replay.
- [x] (2026-11-18) Show receipt messages in the PWA and WhatsApp; accept all 17 WhatsApp codes.
- [x] (2026-11-18) Verify model, route, command, webhook and browser behavior; document outcomes.

## Surprises & Discoveries

The Python service returns `Actionable` even when its trusted-sign filter accepts
no signs. Both backend routes derive multiple-sign severity from their incoming
codes, so an unranked-only report can create a warning. The PWA discards the
server's receipt message after delivery. The WhatsApp command parser recognizes
only older signs and its receipt handler would describe a provisional report as
waiting for a threshold. The older Python API suite cannot collect because it
imports nonexistent constants; keep this pre-existing issue separate from new
behavioral checks.

New tests first reproduced 23 failures in the report routes; the implementation
now passes those checks. Playwright's bundled Chromium was missing, so the
browser tests use installed Chrome with the config in
`artifacts/provisional-indicators/playwright.config.ts`. Managed Next.js server
cleanup hangs on this Windows runner; using an independently started dev server
and `PROVISIONAL_EXTERNAL_SERVER=1` produced a clean exit and 20 passing tests.
Backend report files are tracked with CRLF endings, so whitespace validation
uses Git's `cr-at-eol` setting without changing repository configuration.

## Decision Log

Decision: Keep the existing ten ranked signs and action recommendations. Record
high/low trust explicitly, without inventing numeric weights or new actions.
Rationale: Table B supplies ranks, not new recommendation or severity rules.
Date/author: 2026-11-18 / Codex, implementing the user's accepted policy.

Decision: Return HTTP 200, `ok: true`, `status: pending_validation`,
`inferenceStatus: insufficient_evidence` for fresh unranked-only reports.
Rationale: The observation is successfully stored; retransmission would not
establish evidence. Existing time-based history dispositions remain independent.
Date/author: 2026-11-18 / Codex.

Decision: Filter before aggregation and validate model-returned signs against the
ranked request and ranked active-warning signs. Preserve the current convention
that multiple-sign escalation counts accepted signs from the current batch.
Rationale: Unranked signs and rejected signs must not inflate severity, and old
active-warning codes must not bypass the new policy.
Date/author: 2026-11-18 / Codex.

## Outcomes & Retrospective

The accepted policy is implemented locally across the model, both backend
submission routes, WhatsApp command/reply handling, and PWA receipt storage and
display. No action CSV rows or numeric trust weights were invented. Ranked
inference and beach-profile selection remain supported, while unranked-only
reports cannot create, refresh or distribute warnings. Mixed reports retain
all observations and exclude unranked/rejected codes from local severity.

Verification passed: 75 targeted Python model/API tests, 100 backend route/policy/
command tests, 8 separately run webhook tests, 3 frontend catalog/label tests,
and 20 browser reporting/synchronization scenarios. The frontend production
build passes. Targeted lint has zero errors and two existing unused-function
warnings in alert-card.tsx. Git whitespace checks pass with CRLF handling for
the two existing CRLF backend files.

Full backend TypeScript checking still reports existing errors in unrelated
production modules and older test fixtures; there are no diagnostics in changed
production files or the new helper tests. The legacy Python `test_api.py` import
blocker remains separate from the passing dedicated API tests. No external
deployment, actual WhatsApp send or physical alarm was performed.

## Context and Orientation

`SHAP-model-api/src/engine/inference_engine.py` filters signs and returns a
community classification and an action from CSV. `disaster-backend/src/routes/report.ts`
handles app POSTs, while `report-submit.ts` handles legacy/WhatsApp GETs. Both
persist reports in SQLite before aggregation in Redis. Acknowledgements are
stored with reports and replayed for stable receipt IDs. `openclaw-webhook.ts`
turns authenticated WhatsApp messages into GET submissions and formats replies.
The PWA stores outgoing payloads and received receipts in IndexedDB through
`frontend/src/lib/report-outbox.ts` and displays them with `report-sync-status.tsx`.

## Plan of Work

First add an explicit trust map to the model and backend with a parity regression
check. Populate all model descriptions from Table B. The model must return
`inference_status: insufficient_evidence` and a non-safety-claim recommendation
when it has no eligible signs. It must identify unranked codes separately.

Next introduce shared backend sign classification and model-result filtering.
Both routes must validate known codes, persist the original complete report,
skip aggregation for unranked-only reports, and aggregate ranked signs only.
An explicit empty accepted-sign result must stop warning creation. Sanitize
cached warning inputs and store only ranked accepted warning codes. Include
sign assessment and explanatory messages in durable acknowledgements.

Finally preserve receipt messages and inference status in browser storage and
show them after receipt and reload. The WhatsApp parser must accept explicit
Wn-1 through Wn-17 tokens. Provisional acknowledgements must be replies, never
alert broadcasts. Align short labels used for ranked alerts with Table B.

## Concrete Steps

Use `bun test src/routes/report.test.ts` in `disaster-backend` for both routes.
Run new policy and WhatsApp tests in separate Bun processes when module mocks
overlap. Use the temporary Python environment created for beach-rule tests:

    & (Join-Path ([System.IO.Path]::GetTempPath()) 'peringatan-beach-rules-venv/Scripts/python.exe') -m pytest tests/test_beach_rules_api.py tests/test_inference.py tests/test_provisional_signs.py -q

Run that command in `SHAP-model-api`. In `frontend`, run the catalog tests,
targeted lint and Playwright `e2e/report-sync.spec.ts`, then application build.
Read the installed Next.js client-component guidance before changing frontend
code. Use `git -c core.whitespace=cr-at-eol diff --check` in the root repository
to respect its tracked CRLF backend files, and `git diff --check` in frontend.

For the installed-Chrome browser run, start `bun run dev` in frontend, then in
another PowerShell session in frontend run:

    $env:PROVISIONAL_EXTERNAL_SERVER = '1'
    bunx playwright test --config ../artifacts/provisional-indicators/playwright.config.ts e2e/report-sync.spec.ts e2e/report.spec.ts

Observed result: 20 passed in 36.7 seconds. Stop only the development server
started for this verification afterward.

## Validation and Acceptance

Tests must show every unranked sign is retained and receives an insufficient-
evidence receipt, without queue updates, inference, warning writes or delivery.
Mixed reports must retain unranked codes in storage but send ranked codes only
to the queue and model. One accepted sign plus any unranked/rejected signs must
remain a single-sign decision. Unknown codes and malformed arrays must be
rejected before storage. Freshness rules and stable-ID replay must still work.
Model tests must exercise all 17 signs and all five beach profiles. Browser tests
must show provisional receipts survive reload and stop retries. Independently
configured BMKG assessment remains unchanged; observation-only submissions do
not trigger new BMKG or warning side effects.

## Idempotence and Recovery

Changes are additive except filtering warning eligibility. No database migrations
or data deletion are needed. Existing reports keep their original payload and
acknowledgements. Old cached acknowledgements remain historical receipts and are
not rewritten. New unranked reports cannot refresh an existing warning. Tests
use mocked transports and isolated browser state. Re-running them sends no real
messages or alarms.

## Artifacts and Notes

`docs/strong-wind-rule-mapping.md` records Table B and distinguishes its trust
rankings from recommendations in the existing CSV. Update that draft to document
the implemented policy and remaining validation work when checks finish.

## Interfaces and Dependencies

Use existing Python, pandas, FastAPI, TypeScript, Hono, Bun and Next.js libraries.
Add no runtime dependencies. Backend `SignAssessment` exposes normalized ranked
and unranked codes plus categorical trust metadata. Model outputs add inference
status and unranked codes while preserving the existing prediction fields.
Receipt fields are additive; `ok` and `reportId` remain the delivery contract.

Revision note: initial plan documents the accepted provisional policy and the
specific paths required to make its behavior visible to both reporting channels.

Revision note (2026-11-18): marked implementation complete, captured passing
checks and pre-existing broader-check limitations, and documented the installed
Chrome / external development server workaround used for browser verification.
