import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import beachesRoute from "./beaches";

const app = new Hono().route("/api", beachesRoute);

describe("beach registry", () => {
	test("lists the canonical beach registry", async () => {
		const response = await app.request("/api/beaches");
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.data).toHaveLength(5);
		expect(body.data[0].slug).toBe("pantai_lampuuk");
	});

	test("resolves the nearest beach", async () => {
		const response = await app.request("/api/beaches/nearest?latitude=5.4833&longitude=95.2333");
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.slug).toBe("pantai_lampuuk");
		expect(body.data.distanceMeters).toBe(0);
	});

	test("rejects invalid coordinates", async () => {
		const response = await app.request("/api/beaches/nearest?latitude=95&longitude=200");
		expect(response.status).toBe(400);
	});
});