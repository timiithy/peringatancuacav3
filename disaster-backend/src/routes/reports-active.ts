import { Hono } from "hono";
import { redis } from "../lib/redis";
import { getActiveWarning, QUEUE_PREFIX } from "../lib/crowdsource";
import { LIVE_OBSERVATION_WINDOW_MS, REPORT_THRESHOLD } from "../config";
import { ALLOWED_BEACH_LOCATIONS } from "../types";

const route = new Hono();

route.get("/reports/active", async (c) => {
	const beachLocation = c.req.query("beach_location")?.trim().toLowerCase();

	if (!beachLocation) {
		return c.json({ ok: false, error: "beach_location query param required" }, 400);
	}

	if (!ALLOWED_BEACH_LOCATIONS.includes(beachLocation as (typeof ALLOWED_BEACH_LOCATIONS)[number])) {
		return c.json(
			{
				ok: false,
				error: `beach_location must be one of: ${ALLOWED_BEACH_LOCATIONS.join(", ")}`,
			},
			400,
		);
	}

	const now = Date.now();
	const windowStart = now - LIVE_OBSERVATION_WINDOW_MS;
	const pattern = `${QUEUE_PREFIX}:${beachLocation}:*`;
	const keys = await redis.keys(pattern);

	const counts: Record<string, { count: number; triggered: boolean }> = {};

	for (const key of keys) {
		const suffix = key.slice(`${QUEUE_PREFIX}:${beachLocation}:`.length);
		const code = suffix.toUpperCase();

		const count = await redis.zCount(key, windowStart, now);
		if (count === 0) continue;

		const cooldownKey = `reports:cooldown:${beachLocation}:${code}`;
		const cooldownExists = await redis.get(cooldownKey);

		counts[code] = { count, triggered: cooldownExists !== null };
	}

	const activeWarning = await getActiveWarning(beachLocation);

	return c.json({
		ok: true,
		beach_location: beachLocation,
		window_ms: LIVE_OBSERVATION_WINDOW_MS,
		threshold: REPORT_THRESHOLD,
		counts,
		active_warning: activeWarning,
	});
});

export default route;
