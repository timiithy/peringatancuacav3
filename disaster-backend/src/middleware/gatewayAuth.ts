import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { timingSafeEqual } from "node:crypto";
import { OPENCLAW_WEBHOOK_TOKEN } from "../config";

/** Separate from user JWTs and the token used for outbound OpenClaw requests. */
export function requireGateway(c: Context): void {
	if (!OPENCLAW_WEBHOOK_TOKEN) {
		throw new HTTPException(503, { message: "WhatsApp gateway authentication is not configured" });
	}
	const token = c.req.header("authorization")?.match(/^Bearer ([A-Za-z0-9._~+\/-]+=*)$/i)?.[1];
	const supplied = Buffer.from(token ?? "");
	const expected = Buffer.from(OPENCLAW_WEBHOOK_TOKEN);
	if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
		c.header("WWW-Authenticate", "Bearer");
		throw new HTTPException(401, { message: "Invalid gateway credentials" });
	}
}

export const gatewayAuth: MiddlewareHandler = async (c, next) => {
	requireGateway(c);
	await next();
};
