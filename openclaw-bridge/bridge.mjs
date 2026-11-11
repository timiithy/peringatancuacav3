import { randomUUID } from "node:crypto";
import Redis from "ioredis";

const GATEWAY_HTTP_URL =
  process.env.GATEWAY_HTTP_URL ||
  process.env.GATEWAY_WS_URL?.replace("ws://", "http://").replace(
    "wss://",
    "https://",
  ) ||
  "http://openclaw-openclaw-gateway-1:18789";

const BACKEND_WEBHOOK_URL =
  process.env.BACKEND_WEBHOOK_URL ||
  "http://peringatan-backend:3000/api/openclaw/webhook";

const BACKEND_REPORT_URL =
  process.env.BACKEND_REPORT_URL || "http://peringatan-backend:3000/api/report";
const BACKEND_WEBHOOK_TOKEN = process.env.OPENCLAW_WEBHOOK_TOKEN || "";

const REDIS_URL = process.env.REDIS_URL || "redis://peringatan-redis:6379";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 10);
const OUTBOUND_POLL_MS = Number(process.env.OUTBOUND_POLL_MS || 2000);

const GATEWAY_TOKEN =
  process.env.GATEWAY_TOKEN || "6c7aa1065d6bb7d3b4aa8d05613c79cd6d93eaceafa3c524";

const SESSION_KEY =
  process.env.SESSION_KEY ||
  "agent:main:whatsapp:group:120363406080394106@g.us";

function extractGroupIdFromSessionKey(key) {
  const match = key.match(/:group:(.+)$/) || key.match(/:direct:(.+)$/);
  return match ? match[1] : "";
}

const CHAT_ID = extractGroupIdFromSessionKey(SESSION_KEY);

const REPORT_MARKER_REGEX = /\[REPORT:({[\s\S]*?})\]/g;

const OUTBOUND_STREAM = "openclaw:outbound";

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const redis = new Redis(REDIS_URL);
let outboundLastId = "0";

const authHeaders = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${GATEWAY_TOKEN}`,
};

let lastSeenMessageId = null;
let bootstrapping = true;

function extractMessageText(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return msg.text || "";
}

async function gatewayGet(path) {
  const res = await fetch(`${GATEWAY_HTTP_URL}${path}`, {
    headers: authHeaders,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `gateway GET ${path} failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return res.json();
}

async function gatewayPost(path, body, headers = {}) {
  const res = await fetch(`${GATEWAY_HTTP_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GATEWAY_TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gateway POST ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchSessionHistory() {
  try {
    const encodedKey = encodeURIComponent(SESSION_KEY);
    const data = await gatewayGet(
      `/sessions/${encodedKey}/history?limit=${HISTORY_LIMIT}`,
    );
    const messages = Array.isArray(data)
      ? data
      : data.messages || data.data || [];
    return messages;
  } catch (err) {
    log(`history error: ${err.message}`);
    return [];
  }
}

function extractAndStripReport(text) {
  if (!text) return { cleanText: text, reportPayload: null };
  let reportPayload = null;
  const cleanText = text
    .replace(REPORT_MARKER_REGEX, (_match, jsonStr) => {
      try {
        reportPayload = JSON.parse(jsonStr);
      } catch (e) {
        log(`report marker parse error: ${e.message}`);
      }
      return "";
    })
    .trim();
  return { cleanText, reportPayload };
}

async function sendReportToBackend(reportPayload, senderId) {
  try {
    const res = await fetch(BACKEND_REPORT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BACKEND_WEBHOOK_TOKEN}`,
        ...(senderId && { "x-whatsapp-sender": senderId }),
      },
      body: JSON.stringify({ ...reportPayload, _channel: "WA" }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log(`report POST failed: ${res.status} ${text.slice(0, 200)}`);
    } else {
      const result = await res.json().catch(() => ({}));
      log(`report POST ok: ${JSON.stringify(result).slice(0, 200)}`);
    }
  } catch (err) {
    log(`report POST error: ${err.message}`);
  }
}

async function forwardToBackend(msg) {
  if (msg.role !== "user" && msg.role !== "assistant") {
    return;
  }

  const text = extractMessageText(msg);
  const { cleanText, reportPayload } = extractAndStripReport(text);

  if (reportPayload) {
    log(`detected [REPORT] marker, sending to backend...`);
    // Assistant-generated markers cannot establish who the original reporter was.
    await sendReportToBackend(reportPayload, msg.role === "user" ? msg.from : null);
  }

  const payload = {
    messageId: msg.__openclaw?.id || msg.id || msg.messageId || randomUUID(),
    sessionKey: SESSION_KEY,
    direction: msg.role === "assistant" ? "outgoing" : "incoming",
    from: msg.role === "user" ? msg.from || CHAT_ID : "",
    to: msg.role === "assistant" ? msg.to || CHAT_ID : "",
    senderId: msg.role === "user" ? msg.from || null : null,
    chatId: CHAT_ID,
    text: cleanText || "",
    timestamp: msg.timestamp || msg.createdAt || new Date().toISOString(),
    channel: "whatsapp",
  };

  if (!payload.text) return;

  try {
    const res = await fetch(BACKEND_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BACKEND_WEBHOOK_TOKEN}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log(`webhook failed: ${res.status} ${text.slice(0, 200)}`);
    } else {
      log(
        `forwarded: ${payload.direction} text="${(cleanText || "").slice(0, 60)}"`,
      );
    }
  } catch (err) {
    log(`webhook error: ${err.message}`);
  }
}

async function sendOutboundMessage(target, text) {
  try {
    const result = await gatewayPost("/v1/chat/completions", {
      model: "openclaw",
      messages: [
        {
          role: "user",
          content: `Katakan persis tanpa tambahan apapun:\n\n${text}`,
        },
      ],
      stream: false,
    }, {
      "x-openclaw-message-channel": "whatsapp",
      "x-openclaw-session-key": `agent:main:whatsapp:group:${target}`,
    });

    const reply = result.choices?.[0]?.message?.content || "";
    log(`outbound sent to ${target}: "${(text || "").slice(0, 60)}" -> "${reply.slice(0, 60)}"`);
  } catch (err) {
    log(`outbound send error for ${target}: ${err.message}`);
  }
}

async function pollOutbound() {
  try {
    const events = await redis.xread(
      "STREAMS",
      OUTBOUND_STREAM,
      outboundLastId,
    );

    if (!events || events.length === 0) return;

    log(`outbound got ${events[0]?.[1]?.length || 0} entries from Redis`);

    const [, entries] = events[0];
    for (const [id, rawFields] of entries) {
      const fields = Array.isArray(rawFields)
        ? Object.fromEntries(
            rawFields.reduce((acc, val, i, arr) => {
              if (i % 2 === 0) acc.push([val, arr[i + 1]]);
              return acc;
            }, []),
          )
        : rawFields;
      outboundLastId = id;
      const text = fields.text || "";
      const target = fields.target || "";
      const type = fields.type || "reply";

      if (!text || !target) {
        log(`outbound skip: missing text or target (id=${id})`);
        continue;
      }

      const targets = target.split(",").filter(Boolean);
      for (const t of targets) {
        await sendOutboundMessage(t.trim(), text);
      }
    }
  } catch (err) {
    log(`outbound poll error: ${err.message}`);
  }
}

async function poll() {
  const messages = await fetchSessionHistory();
  if (messages.length === 0) return;

  if (bootstrapping) {
    const latest = messages[0];
    lastSeenMessageId =
      latest.__openclaw?.id || latest.id || latest.messageId || null;
    bootstrapping = false;
    log(`bootstrapped, lastSeenId=${lastSeenMessageId}`);
    return;
  }

  let foundLastSeen = false;
  const newMessages = [];
  for (const msg of messages) {
    const id = msg.__openclaw?.id || msg.id || msg.messageId;
    if (!foundLastSeen && id === lastSeenMessageId) {
      foundLastSeen = true;
      continue;
    }
    if (foundLastSeen) {
      newMessages.push(msg);
    }
  }

  if (!foundLastSeen && messages.length > 0) {
    const latest = messages[messages.length - 1];
    newMessages.push(latest);
  }

  for (const msg of newMessages) {
    const id = msg.__openclaw?.id || msg.id || msg.messageId;
    lastSeenMessageId = id;
    await forwardToBackend(msg);
  }
}

async function main() {
  log(`openclaw-bridge starting (outbound relay only, inbound via gateway hook)`);
  log(`gateway: ${GATEWAY_HTTP_URL}`);
  log(`session: ${SESSION_KEY}`);
  log(`chatId: ${CHAT_ID}`);
  log(`redis: ${REDIS_URL}`);

  while (true) {
    await pollOutbound();
    await new Promise((r) => setTimeout(r, OUTBOUND_POLL_MS));
  }
}

main().catch((err) => {
  log(`fatal: ${err.message}`);
  process.exit(1);
});
