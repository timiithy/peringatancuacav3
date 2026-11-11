import { expect, test } from "bun:test";
import { normalizeWhatsAppSender, webReporterId, whatsAppReporterId } from "./reporter";

const secret = "reporter-tests-persistent-secret-32-characters";

test("browser attribution requires a valid v4 UUID and is separate from report IDs", () => {
	const id = crypto.randomUUID();
	expect(webReporterId(id.toUpperCase())).toBe(`web:${id}`);
	expect(webReporterId(undefined)).toBeNull();
	for (const invalid of [null, "", "web:someone", "wa:someone", 123, "not-a-uuid"]) {
		expect(() => webReporterId(invalid)).toThrow("UUID v4");
	}
});

test("WhatsApp aliases normalize to one account while different senders remain distinct", () => {
	const expected = whatsAppReporterId("628123456789@s.whatsapp.net", secret);
	expect(expected).toMatch(/^wa:[0-9a-f]{64}$/);
	for (const alias of ["+628123456789", "628123456789@c.us", "628123456789:12@s.whatsapp.net"]) {
		expect(whatsAppReporterId(alias, secret)).toBe(expected);
	}
	expect(whatsAppReporterId("628999999999@s.whatsapp.net", secret)).not.toBe(expected);
	expect(whatsAppReporterId("628123456789@s.whatsapp.net", `${secret}-other`)).not.toBe(expected);
	expect(expected).not.toContain("628123456789");
	expect(normalizeWhatsAppSender("123456789@lid")).toBe("123456789@lid");
});

test("group IDs and missing or ambiguous senders never become reporter identities", () => {
	for (const sender of [undefined, null, "", "120363406080394106@g.us", "status@broadcast", "fisherman", "agent:main:whatsapp:group:123@g.us"]) {
		expect(whatsAppReporterId(sender, secret)).toBeNull();
	}
});

test("WhatsApp attribution fails closed without a persistent secret", () => {
	for (const key of ["", "short"]) {
		expect(() => whatsAppReporterId("628123456789@c.us", key)).toThrow("not configured");
	}
});
