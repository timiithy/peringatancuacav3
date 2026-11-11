import { expect, mock, test } from "bun:test";
import { Hono } from "hono";

mock.module("../config", () => ({ OPENCLAW_WEBHOOK_TOKEN: "" }));
const { gatewayAuth } = await import("./gatewayAuth");

test("missing relay configuration cannot silently permit WhatsApp ingestion", async () => {
	let reached = false;
	const app = new Hono().post("/webhook", gatewayAuth, (c) => {
		reached = true;
		return c.json({ ok: true });
	});
	const response = await app.request("/webhook", { method: "POST", headers: { authorization: "Bearer any-token" } });
	expect(response.status).toBe(503);
	expect(reached).toBe(false);
});
