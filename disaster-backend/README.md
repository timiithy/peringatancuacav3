# Disaster Backend (Distribution Hub)

Distribution Hub for disaster reporting experiments:
- ingest nelayan reports
- call ML inference (`/predict`)
- generate canonical `alertEvent`
- distribute via `SSE` / `WS` / `Web Push`
- log evidence to Redis for thesis metrics

## Tech Stack

- Runtime: Bun
- API framework: Hono
- Data/logging: Redis (Pub/Sub + Streams + Hash)
- ML integration: external/internal HTTP service (`POST /predict`)
- IoT delivery: MQTT.js publisher to Mosquitto

## Architecture (High Level)

1. Client sends report to `POST /api/report`
2. Backend calls ML service: `POST {ML_BASE_URL}/predict`
3. Backend creates canonical `alertEvent`
4. Backend writes `alertEvent` to Redis stream (`alerts:stream`)
5. If distributable, backend publishes to Redis Pub/Sub channel (`alerts:high`)
6. Connected SSE/WS clients receive the same payload; push subscribers receive notification
7. For `SIAGA` and `EKSTREM`, backend publishes an IoT command to MQTT topic `alert/<beach_location>`
8. Clients send `POST /api/ack`; backend logs ACK stream (`alerts:acks`)
9. Offline/sync evidence is logged to `reports:sync`

## Prerequisites

- Bun `>= 1.3.x`
- Docker + Docker Compose
- Redis (if running without compose)
- ML service exposing `POST /predict`

## Quick Start (Docker Compose)

### 1) Run app + Redis + ML container

ML image used in compose:
- `scaferuzzz/shap-api:latest`

```bash
docker compose --profile ml up -d --build
```

### 2) Run app + Redis only (ML external)

```bash
ML_BASE_URL=http://host.docker.internal:8000 docker compose up -d --build
```

### 3) Check status

```bash
docker compose ps
docker compose logs -f app
```

### 4) Health check

```bash
curl -s http://localhost:3000/api/health | jq .
```

Expected keys: `ok`, `redis`, `mlBaseUrl`, `streams`, `delivery`, `push`.

## Local Development (Bun)

### 1) Install dependencies

```bash
bun install
```

### 2) Start Redis (example via docker)

```bash
docker compose up -d redis
```

### 3) Set environment

Create/update `.env`:

```env
PORT=3000
REDIS_URL=redis://localhost:6379
ML_BASE_URL=http://localhost:8000
ALERTS_CHANNEL=alerts:high
ALERTS_STREAM=alerts:stream
ACKS_STREAM=alerts:acks
REPORT_SYNC_STREAM=reports:sync
REPORT_DEDUPE_PREFIX=reports:dedupe
PUSH_SUBSCRIPTIONS_HASH=alerts:push:subscriptions
ENABLE_SSE_DELIVERY=true
ENABLE_WS_DELIVERY=true
ENABLE_PUSH_DELIVERY=true
ENABLE_IOT_MQTT_DELIVERY=false
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_TOPIC_PREFIX=alert
MQTT_QOS=1
MQTT_RETAIN=false
MQTT_ALARM_DURATION_MS=15000
MQTT_PUBLISH_TIMEOUT_MS=2000
# Optional JWT auth for /api/*
JWT_AUTH_ENABLED=false
JWT_SECRET=replace-with-long-random-secret
JWT_EXPIRES_SECONDS=86400
JWT_COOKIE_NAME=auth_token
JWT_PUBLIC_PATHS=/api/health,/api/docs,/api/openapi.json,/api/push/vapid-public-key,/api/auth/register,/api/auth/login
# Optional auth key prefixes
AUTH_USER_KEY_PREFIX=auth:user
AUTH_USER_EMAIL_KEY_PREFIX=auth:user:email
AUTH_USER_IDENTITY_KEY_PREFIX=auth:user:identity
# Optional for push
VAPID_SUBJECT=mailto:you@example.com
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

### 4) Run backend

```bash
bun run dev
```

## Core Scripts

```bash
bun run dev
bun run push:vapid:generate
bun run stage6:reset
bun run stage6:run -- --label=sse_3g_r1
bun run stage6:load -- --count=50 --interval-ms=1000
bun run stage6:export -- --out-dir=experiments/stage6/smoke/raw
bun run stage6:analyze -- --raw-dir=experiments/stage6/smoke/raw --out-dir=experiments/stage6/smoke/analysis --protocol=SSE --network=3G
bun run stage6:sample:resources -- --pid=<PID> --interval-ms=2000 --duration-s=180 --output=experiments/stage6/smoke/raw/resources.csv
```

## API Summary

Interactive docs:
- Swagger UI: `GET /api/docs`
- OpenAPI JSON: `GET /api/openapi.json`

Default local URLs:
- Swagger UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/openapi.json`

Main endpoints:
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/report`
- `GET /api/history`
- `POST /api/ack`
- `GET /api/sse`
- `GET /api/ws`
- `GET /api/push/vapid-public-key`
- `POST /api/push/subscribe`
- `POST /api/push/unsubscribe`

## Example: Submit Report

```bash
curl -X POST http://localhost:3000/api/report \
  -H "content-type: application/json" \
  -d '{
    "lik_codes": ["wn-1", "wn-2", "wn-3", "wn-4"],
    "beach_location": "pantai_lampuuk",
    "clientReportId": "11111111-1111-4111-8111-111111111111",
    "createdAtClient": 1739270400000
  }'
```

If JWT auth is enabled:

```bash
TOKEN="<jwt-from-login>"
curl -X POST http://localhost:3000/api/report \
  -H "authorization: Bearer ${TOKEN}" \
  -H "content-type: application/json" \
  -d '{ "...": "..." }'
```

## Example: Get History

```bash
TOKEN="<jwt-from-login>"
curl "http://localhost:3000/api/history?limit=20&mine=true" \
  -H "authorization: Bearer ${TOKEN}"
```

Only distributed alerts:

```bash
TOKEN="<jwt-from-login>"
curl "http://localhost:3000/api/history?limit=20&mine=true&distributed=true" \
  -H "authorization: Bearer ${TOKEN}"
```

## Example: Register and Login

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "content-type: application/json" \
  -d '{
    "nama": "Budi Nelayan",
    "noIdentitasNelayan": "NLYN-001122",
    "email": "budi@example.com",
    "password": "strongpass123"
  }'
```

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "content-type: application/json" \
  -d '{
    "email": "budi@example.com",
    "password": "strongpass123"
  }'
```

## Example: Send ACK

```bash
curl -X POST http://localhost:3000/api/ack \
  -H "content-type: application/json" \
  -d '{
    "alertId": "<alert-id>",
    "transport": "SSE",
    "ackStage": "DELIVERED",
    "receivedAtClient": 1739270401234,
    "serverTimestamp": 1739270400123,
    "clientId": "receiver-1"
  }'
```

## Browser Test Pages

- `GET /` -> report form PWA (offline queue + sync)
- `GET /receiver` -> SSE/WS receiver harness with automatic ACK

## Redis Data Used

- Pub/Sub channel: `alerts:high`
- Streams:
  - `alerts:stream` (canonical alerts)
  - `alerts:acks` (delivery ACK events)
  - `reports:sync` (offline sync evidence)
- Hash:
  - `alerts:push:subscriptions`

## Docker Notes

- App container listens on internal port `3000`.
- Default host mapping is `${APP_PORT:-3000}:3000`.
- Redis default host mapping is `${REDIS_PORT:-6379}:6379`.
- ML container mapping is `${ML_PORT:-8000}:8000` when using `--profile ml`.
- If host port `6379` is already used:

```bash
REDIS_PORT=6380 docker compose --profile ml up -d --build
```

## Deploying to VPS/Kubernetes

- `Dockerfile` is production-ready for image build/runtime.
- `docker-compose.yml` is mainly for local or single-host deployments.
- For Kubernetes, use built images + manifests/Helm; compose is not required.

## Troubleshooting

### Redis port already allocated

Use another host port:

```bash
REDIS_PORT=6380 docker compose up -d --build
```

### ML unreachable

- If using profile `ml`, use `ML_BASE_URL=http://ml:8000`
- If ML runs outside compose, set `ML_BASE_URL` accordingly

### Push endpoints return 503

Set all VAPID env vars:
- `VAPID_SUBJECT`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Generate keys:

```bash
bun run push:vapid:generate
```

## Reporter lookup

Reports can retain pseudonymous browser or WhatsApp account attribution. Run `bun run reporter:lookup '<report-id>'` from this directory to inspect matching submissions through a read-only SQLite connection. See [configuration and limitations](../docs/reporter-attribution.md), including the two environment variables required for authenticated WhatsApp ingestion.
