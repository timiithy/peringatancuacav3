import { createHmac } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { REPORTER_HMAC_SECRET } from "../config";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A browser-supplied pseudonym, not a verified account or person. */
export function webReporterId(browserId: unknown): string | null {
	if (browserId === undefined) return null; // Older clients remain unattributed.
	if (typeof browserId !== "string" || !UUID.test(browserId)) {
		throw new HTTPException(400, { message: "reporterBrowserId must be a UUID v4 string" });
	}
	return `web:${browserId.toLowerCase()}`;
}

/** Never treat group, broadcast, session, or display-name values as a person. */
export function normalizeWhatsAppSender(sender: unknown): string | null {
	if (typeof sender !== "string" || sender.length > 128) return null;
	const value = sender.trim().toLowerCase();
	if (/^\+?\d{5,20}$/.test(value)) return `${value.replace(/^\+/, "")}@s.whatsapp.net`;
	const match = value.match(/^(\d{5,20})(?::\d+)?@(s\.whatsapp\.net|c\.us|lid)$/);
	if (!match) return null;
	return `${match[1]}@${match[2] === "c.us" ? "s.whatsapp.net" : match[2]}`;
}

/** Call only after authenticating the gateway carrying this sender address. */
export function whatsAppReporterId(sender: unknown, secret = REPORTER_HMAC_SECRET): string | null {
	const normalized = normalizeWhatsAppSender(sender);
	if (!normalized) return null;
	if (!secret || secret.length < 32) {
		throw new HTTPException(503, { message: "WhatsApp reporter attribution is not configured" });
	}
	const digest = createHmac("sha256", secret).update(`whatsapp:${normalized}`).digest("hex");
	return `wa:${digest}`;
}
