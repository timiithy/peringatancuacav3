const BACKEND_URL = process.env.BACKEND_WEBHOOK_URL || "http://peringatan-backend:3000/api/openclaw/webhook";
const SESSION_KEY = process.env.SESSION_KEY || "agent:main:whatsapp:group:120363406080394106@g.us";

function extractGroupIdFromSessionKey(key) {
  const match = key.match(/:group:(.+)$/) || key.match(/:direct:(.+)$/);
  return match ? match[1] : "";
}

async function handler(event) {
  if (event.type !== "message" || event.action !== "received") return;

  const ctx = event.context || {};
  const content = ctx.content || "";
  const from = ctx.from || "";
  const channelId = ctx.channelId || "";
  const metadata = ctx.metadata || {};
  const chatId = ctx.conversationId || extractGroupIdFromSessionKey(event.sessionKey || "") || from;
  // `from` must come from gateway metadata, never the group/session fallback.
  const senderId = metadata.senderId || metadata.senderE164 || from || null;

  if (!content) return;
  const webhookToken = process.env.OPENCLAW_WEBHOOK_TOKEN;
  if (!webhookToken) {
    throw new Error("OPENCLAW_WEBHOOK_TOKEN is required to forward WhatsApp messages");
  }

  const payload = {
    messageId: ctx.messageId || event.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionKey: event.sessionKey || SESSION_KEY,
    direction: "incoming",
    from: from || chatId,
    to: chatId,
    senderId,
    chatId,
    text: content,
    timestamp: ctx.timestamp ?? event.timestamp ?? new Date().toISOString(),
    channel: channelId.includes("whatsapp") ? "whatsapp" : channelId || "whatsapp",
  };

  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${webhookToken}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`backend webhook returned HTTP ${response.status}`);
  } catch (err) {
    console.error(`[webhook-relay] forward failed: ${err.message}`);
  }
}

export default handler;
