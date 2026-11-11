# Reporter attribution

Each new report can be linked to a persistent pseudonym in SQLite's `reports.reporter_id`. An administrator can look up a report and find other reports with the same pseudonym. No login is required for browser reporting.

## Browser reports

The PWA and the older backend reporting page create a random UUID v4 and save it under the local storage key `peringatan-reporter-browser-id:v1`. Each report copies this value into `reporterBrowserId` before it is saved or sent. The server validates it and stores `web:<uuid>` in `reporter_id`. `clientReportId` continues to identify an individual report, while `reporterBrowserId` identifies the browser installation.

Offline retries use the original stored payload, including the reporter UUID. A later change to browser storage does not reattribute already queued reports. Older queued payloads without this field remain unattributed. Failure to save the browser identifier prevents a new submission instead of silently assigning a different identity every time.

This is an unverified browser label. Clearing storage, using another browser/profile, or deliberately changing the UUID creates another identity. Multiple people sharing one browser share its label. Browser and WhatsApp labels are not automatically linked. IP addresses are not used as reporter identities.

## WhatsApp reports

The gateway relay sends `senderId` and `chatId` separately. `senderId` comes from gateway sender metadata or the original `from`, while `chatId` is used to route replies. Group IDs are never accepted as a sender. Missing or unsupported sender metadata produces null attribution rather than assigning all group members the same pseudonym.

The backend normalizes supported personal addresses (`@s.whatsapp.net`, `@c.us`, `@lid`, or international digits with an optional leading `+`). Device suffixes such as `:12` are removed, and `@c.us` aliases normalize to `@s.whatsapp.net`. A phone address and an unrelated `@lid` address cannot be linked without additional verified mapping from the provider.

For a known sender the server stores `wa:` followed by an HMAC-SHA256 digest of the normalized sender address. HMAC is a keyed digest: the same account and persistent secret yield the same pseudonym without putting a phone number in the reports table. It is not reversible into a contact address. Existing private webhook logs still contain their original message metadata; this feature does not remove or change their retention.

## Configuration and rollout

Set two independent, randomly generated secrets in the backend environment:

```dotenv
OPENCLAW_WEBHOOK_TOKEN=<random-relay-credential>
REPORTER_HMAC_SECRET=<persistent-random-secret-at-least-32-characters>
```

Generate each value separately, for example with `openssl rand -hex 32`, and retain them in your deployment's secret storage. Do not use the placeholder strings above. Keep `REPORTER_HMAC_SECRET` stable across restarts and deployments; changing it creates different WhatsApp labels for future reports. It is independent of JWT authentication and the outbound `OPENCLAW_HOOK_TOKEN`.

Configure the same `OPENCLAW_WEBHOOK_TOKEN` in the OpenClaw gateway process that loads `openclaw-hooks/webhook-relay/handler.ts`. The hook runs in that gateway, not in the backend or the outbound bridge. Redeploy/reload the updated hook and restart the backend with these environment settings together. All three backend Compose files forward the variables, and the root Compose file also forwards the inbound token to the optional bridge. The external OpenClaw gateway must receive the token through its own deployment configuration.

`POST /api/openclaw/webhook` requires `Authorization: Bearer <OPENCLAW_WEBHOOK_TOKEN>` for every event. WhatsApp submissions to `GET /api/report/submit?channel=WA` (also accepting `WHATSAPP`) and `POST /api/report` with `_channel: "WA"` or `"WHATSAPP"` require the same credential. The actual sender is forwarded in the `x-whatsapp-sender` header rather than in query parameters. Keep the token and raw sender headers on the trusted gateway/backend path and use HTTPS when that path crosses an untrusted network.

Missing gateway configuration returns HTTP 503; incorrect or missing credentials return HTTP 401. A known sender with an absent or short HMAC secret returns HTTP 503. Unknown senders can still have reports accepted without attribution when the gateway is authenticated. Never send these secrets to the browser.

Legacy GET submissions using `message_id` also require the gateway credential, because this parameter addresses the WhatsApp receipt namespace. Authenticated WhatsApp POST receipts and cache keys use a separate namespace from browser POST receipts so a public browser submission cannot claim their receipt IDs first. Plain legacy browser GET submissions without a message ID remain accepted and unattributed.

On backend startup, the additive `0001_fresh_black_tom.sql` migration creates an index on `reports.reporter_id`. The fallback table creation path creates the same index. No reports or other tables are deleted. Existing report attribution is preserved; no historical backfill is attempted.

## Administrator lookup

From `disaster-backend`, using the same SQLite file as the application:

```powershell
bun run reporter:lookup 'web:<client-report-uuid>'
bun run reporter:lookup 'whatsapp:<message-id>' --limit 25
```

`DATABASE_URL` defaults to `sqlite://./data/disaster.db`. Set it to the actual SQLite file if needed. The command opens that file read-only and does not create a new database if the path is wrong. IDs containing shell-special characters should be quoted.

For the root Compose deployment:

```text
docker compose exec backend bun run reporter:lookup 'whatsapp:<message-id>' --limit 25
```

The CLI lives under `src/cli` so it is included in the existing backend Docker image. Its output includes the requested report, reporter pseudonym, attribution type, total matching reports, a list of report summaries, and a `truncated` flag. The default limit is 100 and the maximum is 1000. Summaries include report ID, channel, beach, creation time and natural signs; raw request bodies and webhook credentials are omitted. An unknown reporter returns only the requested report and an explanation, never all reports with null attribution. Missing report IDs or invalid arguments exit with a nonzero status.

Use the `reportId` returned in the submission acknowledgement as the lookup argument. Queued, stale, time-uncertain and alert-triggering reports are all stored before processing and can be looked up. Replaying a stable report ID retains its first reporter association.

There is no public reporter lookup endpoint. New pseudonyms are not added to public alerts, acknowledgements, SSE/WebSocket/Push events, or IoT broadcasts. Alert thresholds and the existing `reporterCount` calculation are unchanged; distinct-reporter counting remains a separate policy change.
