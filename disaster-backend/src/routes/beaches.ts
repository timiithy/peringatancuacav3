import { Hono } from "hono";
import { BEACH_REGISTRY } from "../types";
import { findNearestBeach } from "../lib/beach-location";

const route = new Hono();

route.get("/beaches", (c) => c.json({ ok: true, data: BEACH_REGISTRY }));

route.get("/beaches/nearest", (c) => {
	const latitude = Number(c.req.query("latitude"));
	const longitude = Number(c.req.query("longitude"));
	const nearest = findNearestBeach(latitude, longitude);
	if (!nearest) {
		return c.json({ ok: false, error: "valid latitude and longitude are required" }, 400);
	}
	return c.json({
		ok: true,
		data: {
			...nearest.beach,
			distanceMeters: Math.round(nearest.distanceMeters),
		},
	});
});

export default route;