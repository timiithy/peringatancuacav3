import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Hono } from "hono";

const replies: string[] = [];
const logged: Record<string, string>[] = [];
const headers = { "content-type": "application/json", authorization: "Bearer test-gateway-token" };
mock.module("../config", () => ({ OPENCLAW_WEBHOOK_TOKEN: "test-gateway-token", REPORTER_HMAC_SECRET: "test-reporter-secret-at-least-32-characters" }));
mock.module("../lib/redis", () => ({ redis: { xAdd: async (_key: string, _id: string, fields: Record<string, string>) => { logged.push(fields); return "0-0"; } } }));
mock.module("../lib/openclaw", () => ({ sendOpenClawReply: async (_to: string, text: string) => { replies.push(text); } }));
const { default: route } = await import("./openclaw-webhook");
const app = new Hono().route("/api", route);
const originalFetch = globalThis.fetch;
const urls: URL[] = [];
const forwardedHeaders: Headers[] = [];
beforeEach(() => {
  replies.length = 0;
  urls.length = 0;
  logged.length = 0;
  forwardedHeaders.length = 0;
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); urls.push(url);
    forwardedHeaders.push(new Headers(init?.headers));
    return Response.json({ ok: true, status: url.searchParams.has("observed_at") ? "archived" : "time_uncertain", message: "Laporan diterima sebagai riwayat." });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; });

test("WhatsApp forwards original message time, identity and explicit observation time", async () => {
  const timestamp = Date.parse("2026-10-15T08:10:00+07:00");
  const res = await app.request("/api/openclaw/webhook", { method: "POST", headers, body: JSON.stringify({ direction: "incoming", from: "628123456789@c.us", messageId: "original-wa-id", timestamp: timestamp / 1000, text: "!lapor lampuuk angin kencang waktu=2026-10-15T08:00:00+07:00" }) });
  expect(res.status).toBe(200);
  expect(urls[0]!.searchParams.get("created_at_client")).toBe(String(timestamp));
  expect(urls[0]!.searchParams.get("observed_at")).toBe(String(timestamp - 600000));
  expect(urls[0]!.searchParams.get("message_id")).toBe("original-wa-id");
  expect(forwardedHeaders[0]!.get("authorization")).toBe("Bearer test-gateway-token");
  expect(forwardedHeaders[0]!.get("x-whatsapp-sender")).toBe("628123456789@s.whatsapp.net");
  expect(urls[0]!.toString()).not.toContain("628123456789");
  expect(replies[0]).toContain("riwayat");
});

test("WhatsApp never uses webhook arrival to invent observation time", async () => {
  await app.request("/api/openclaw/webhook", { method: "POST", headers, body: JSON.stringify({ direction: "incoming", from: "fisherman", text: "!lapor lampuuk angin kencang waktu=sekarang" }) });
  expect(urls[0]!.searchParams.has("observed_at")).toBe(false);
  expect(replies[0]).toContain("waktu=sekarang");
});

test("WhatsApp provisional acknowledgement does not promise a warning or more threshold votes", async () => {
  const message = "Laporan Wn-16 dicatat. Bukti belum cukup untuk inferensi tanda alam.";
  globalThis.fetch = mock(async () => Response.json({
    ok: true, reportId: "provisional-wa", status: "pending_validation",
    inferenceStatus: "insufficient_evidence", shouldDistribute: false, message,
  })) as unknown as typeof fetch;
  await app.request("/api/openclaw/webhook", {
    method: "POST", headers,
    body: JSON.stringify({ direction: "incoming", from: "fisherman", timestamp: Date.now(), text: "!lapor lampuuk WN-16 waktu=sekarang" }),
  });
  expect(replies).toEqual([message]);
  expect(replies[0]).not.toContain("threshold");
  expect(replies[0]).not.toContain("Aman");
});

test("WhatsApp mixed-report reply preserves the provisional note and current warning label", async () => {
  globalThis.fetch = mock(async () => Response.json({
    ok: true, status: "triggered", shouldDistribute: true,
    message: "Wn-16 dicatat dan belum digunakan untuk peringatan.",
    alertEvent: { riskLevel: "waspada", reporterCount: 1 },
  })) as unknown as typeof fetch;
  await app.request("/api/openclaw/webhook", {
    method: "POST", headers,
    body: JSON.stringify({ direction: "incoming", from: "fisherman", text: "!lapor lampuuk WN-4 WN-16 waktu=sekarang" }),
  });
  expect(replies[0]).toContain("WASPADA");
  expect(replies[0]).toContain("Wn-16 dicatat");
  expect(replies[0]).not.toContain("Aman");
});

test("WhatsApp explicit sekarang uses original message creation, including delayed delivery", async () => {
  const timestamp = Date.parse("2026-10-15T08:00:00+07:00");
  await app.request("/api/openclaw/webhook", { method: "POST", headers, body: JSON.stringify({ direction: "incoming", from: "fisherman", timestamp, text: "!lapor lampuuk angin kencang waktu=sekarang" }) });
  expect(urls[0]!.searchParams.get("observed_at")).toBe(String(timestamp));
});

test("different senders in one group forward their own account identifier", async () => {
  for (const senderId of ["628123456789@c.us", "628999999999@c.us"]) {
    const res = await app.request("/api/openclaw/webhook", {
      method: "POST", headers,
      body: JSON.stringify({ direction: "incoming", from: "120363406080394106@g.us", chatId: "120363406080394106@g.us", senderId, text: "!lapor lampuuk angin kencang waktu=sekarang" }),
    });
    expect(res.status).toBe(200);
  }
  expect(forwardedHeaders[0]!.get("x-whatsapp-sender")).toBe("628123456789@s.whatsapp.net");
  expect(forwardedHeaders[1]!.get("x-whatsapp-sender")).toBe("628999999999@s.whatsapp.net");
});

test("group-only or explicitly unknown sender metadata stays unattributed", async () => {
  for (const body of [
    { from: "120363406080394106@g.us" },
    { from: "628123456789@c.us", senderId: null },
  ]) {
    await app.request("/api/openclaw/webhook", { method: "POST", headers, body: JSON.stringify({ ...body, direction: "incoming", text: "!lapor lampuuk angin kencang waktu=sekarang" }) });
    expect(forwardedHeaders.at(-1)!.has("x-whatsapp-sender")).toBe(false);
  }
});

test("unauthenticated and incorrect webhook credentials cannot log or submit reports", async () => {
  for (const authorization of [undefined, "Bearer incorrect-token"]) {
    const res = await app.request("/api/openclaw/webhook", {
      method: "POST", headers: { "content-type": "application/json", ...(authorization && { authorization }) },
      body: JSON.stringify({ direction: "incoming", from: "628123456789@c.us", text: "!lapor lampuuk angin kencang" }),
    });
    expect(res.status).toBe(401);
  }
  expect(logged).toHaveLength(0);
  expect(urls).toHaveLength(0);
  expect(replies).toHaveLength(0);
});
