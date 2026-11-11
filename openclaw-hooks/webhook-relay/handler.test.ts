import { afterEach, expect, mock, test } from "bun:test";
import handler from "./handler";

const originalFetch = globalThis.fetch;
const originalToken = process.env.OPENCLAW_WEBHOOK_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.OPENCLAW_WEBHOOK_TOKEN;
  else process.env.OPENCLAW_WEBHOOK_TOKEN = originalToken;
});

test("relay separates actual sender from group and authenticates without leaking the token into URLs", async () => {
  process.env.OPENCLAW_WEBHOOK_TOKEN = "relay-test-token";
  let sent: Record<string, unknown> = {};
  let headers = new Headers();
  globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    headers = new Headers(init.headers);
    return Response.json({ success: true });
  }) as unknown as typeof fetch;
  await handler({ type: "message", action: "received", sessionKey: "agent:main:whatsapp:group:120363406080394106@g.us", context: {
    content: "!lapor lampuuk angin kencang", channelId: "whatsapp", from: "120363406080394106@g.us",
    metadata: { senderId: "628123456789@c.us" }, messageId: "original-message", timestamp: 123456,
  } });
  expect(sent.senderId).toBe("628123456789@c.us");
  expect(sent.chatId).toBe("120363406080394106@g.us");
  expect(sent.messageId).toBe("original-message");
  expect(sent.timestamp).toBe(123456);
  expect(headers.get("authorization")).toBe("Bearer relay-test-token");
});

test("relay with no sender leaves attribution unknown and retains the reply group", async () => {
  process.env.OPENCLAW_WEBHOOK_TOKEN = "relay-test-token";
  let sent: Record<string, unknown> = {};
  globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    return Response.json({ success: true });
  }) as unknown as typeof fetch;
  await handler({ type: "message", action: "received", sessionKey: "agent:main:whatsapp:group:120363406080394106@g.us", context: { content: "!lapor", channelId: "whatsapp" } });
  expect(sent.senderId).toBeNull();
  expect(sent.chatId).toBe("120363406080394106@g.us");
});

test("relay without credentials does not forward incoming messages", async () => {
  delete process.env.OPENCLAW_WEBHOOK_TOKEN;
  const send = mock(async () => Response.json({}));
  globalThis.fetch = send as unknown as typeof fetch;
  await expect(handler({ type: "message", action: "received", context: { content: "!lapor" } })).rejects.toThrow("OPENCLAW_WEBHOOK_TOKEN");
  expect(send).not.toHaveBeenCalled();
});
