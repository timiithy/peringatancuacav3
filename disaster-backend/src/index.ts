import { Hono } from "hono";
import { websocket } from "hono/bun";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { initRedis, sub } from "./lib/redis";
import { initDb } from "./db";
import { initWebPush, sendPushAlertToAll } from "./lib/push";
import {
	ALERTS_CHANNEL,
	CORS_ALLOWED_ORIGINS,
	ENABLE_PUSH_DELIVERY,
	ENABLE_SSE_DELIVERY,
	ENABLE_WS_DELIVERY,
	PORT,
} from "./config";
import healthRoute from "./routes/health";
import sseRoute, { sseClients } from "./routes/sse";
import wsRoute, { wsClients } from "./routes/ws";
import pushRoute from "./routes/push";
import ackRoute from "./routes/ack";
import reportRoute from "./routes/report";
import historyRoute from "./routes/history";
import webRoute from "./routes/web";
import docsRoute from "./routes/docs";
import authRoute from "./routes/auth";
import openclawWebhookRoute from "./routes/openclaw-webhook";
import reportsActiveRoute from "./routes/reports-active";
import bmkgRoute from "./routes/bmkg";
import alertsRoute from "./routes/alerts";
import reportSubmitRoute from "./routes/report-submit";
import broadcastMorningRoute from "./routes/broadcast-morning";
import beachesRoute from "./routes/beaches";

const app = new Hono();
app.use(
	"/api/*",
	cors({ origin: CORS_ALLOWED_ORIGINS.includes("*") ? "*" : CORS_ALLOWED_ORIGINS }),
);
app.onError((err, c) => {
	console.error("[unhandled-error]", {
		path: c.req.path,
		method: c.req.method,
		error: err instanceof Error ? err.message : String(err),
	});

	if (err instanceof HTTPException) {
		return err.getResponse();
	}

	if (c.req.path.startsWith("/api/")) {
		return c.json({ ok: false, error: "internal server error" }, 500);
	}

	return c.text("Internal Server Error", 500);
});

await initRedis();
initDb();
initWebPush();

await sub.subscribe(ALERTS_CHANNEL, async (message) => {
	console.log("[sub] received alert from Redis, SSE clients:", sseClients.size, "WS clients:", wsClients.size);
	if (ENABLE_SSE_DELIVERY) {
		for (const client of sseClients) {
			try {
				await client.writeSSE({ event: "alert", data: message });
			} catch {
				sseClients.delete(client);
			}
		}
	}

	if (ENABLE_WS_DELIVERY) {
		for (const client of wsClients) {
			if (client.readyState !== WebSocket.OPEN) {
				wsClients.delete(client);
				continue;
			}
			try {
				client.send(message);
			} catch {
				wsClients.delete(client);
			}
		}
	}

	if (ENABLE_PUSH_DELIVERY) {
		console.log("[push] attempting push delivery");
		const pushResult = await sendPushAlertToAll(message);
		console.log("[push] result:", pushResult);
	}
});

app.route("/api", healthRoute);
app.route("/api", sseRoute);
app.route("/api", wsRoute);
app.route("/api", pushRoute);
app.route("/api", ackRoute);
app.route("/api", reportRoute);
app.route("/api", historyRoute);
app.route("/api", docsRoute);
app.route("/api", authRoute);
app.route("/api", openclawWebhookRoute);
app.route("/api", reportsActiveRoute);
app.route("/api", bmkgRoute);
app.route("/api", alertsRoute);
app.route("/api", reportSubmitRoute);
app.route("/api", broadcastMorningRoute);
app.route("/api", beachesRoute);
app.route("/", webRoute);

export default {
	port: PORT,
	idleTimeout: 0,
	fetch: app.fetch,
	websocket,
};
