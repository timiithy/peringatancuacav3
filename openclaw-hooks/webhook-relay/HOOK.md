---
name: webhook-relay
description: "Forward inbound WhatsApp messages to backend webhook"
metadata:
  { "openclaw": { "emoji": "📤", "events": ["message:received"], "always": true } }
---

# Webhook Relay

Forwards every inbound WhatsApp message to the disaster backend webhook for command interception.

Set `OPENCLAW_WEBHOOK_TOKEN` in the gateway process to the same value as the backend. The relay sends it as a bearer credential. The backend also needs a separate persistent `REPORTER_HMAC_SECRET` of at least 32 characters to derive reporter pseudonyms.

The relay forwards the actual sender separately from the reply chat. Missing sender metadata is left unknown; group IDs are never used for account attribution by the backend. Original message IDs and timestamps are preserved when provided by the gateway context.

See [reporter attribution setup](../../docs/reporter-attribution.md) for deployment and administrator lookup instructions.
