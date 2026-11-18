const DB_NAME = "disaster-stage5";
const DB_VERSION = 1;
const STORE_NAME = "queued_reports";
const REPORT_ENDPOINT = "/api/report";
const SYNC_TAG = "report-sync";
const PUSH_VAPID_ENDPOINT = "/api/push/vapid-public-key";
const PUSH_SUBSCRIBE_ENDPOINT = "/api/push/subscribe";
const PUSH_UNSUBSCRIBE_ENDPOINT = "/api/push/unsubscribe";
const AUTH_REGISTER_ENDPOINT = "/api/auth/register";
const AUTH_LOGIN_ENDPOINT = "/api/auth/login";
const AUTH_LOGOUT_ENDPOINT = "/api/auth/logout";
const API_TOKEN_KEY = "authToken";
const REPORTER_STORAGE_KEY = "peringatan-reporter-browser-id:v1";

async function getReporterBrowserId() {
  const getOrCreate = () => {
    const saved = localStorage.getItem(REPORTER_STORAGE_KEY);
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved.toLowerCase();
    const id = crypto.randomUUID();
    localStorage.setItem(REPORTER_STORAGE_KEY, id);
    return id;
  };
  if (navigator.locks) return navigator.locks.request(REPORTER_STORAGE_KEY, getOrCreate);
  return getOrCreate();
}

const form = document.getElementById("report-form");
const authForm = document.getElementById("auth-form");
const authRegisterButton = document.getElementById("auth-register");
const authLoginButton = document.getElementById("auth-login");
const authLogoutButton = document.getElementById("auth-logout");
const flushNowButton = document.getElementById("flush-now");
const pushToggleButton = document.getElementById("push-toggle");
const logNode = document.getElementById("log");
const networkState = document.getElementById("network-state");
const authState = document.getElementById("auth-state");

if (
  !form ||
  !authForm ||
  !authRegisterButton ||
  !authLoginButton ||
  !authLogoutButton ||
  !flushNowButton ||
  !pushToggleButton ||
  !logNode ||
  !networkState ||
  !authState
) {
  throw new Error("required UI element missing; reload page and ensure latest index.html is loaded");
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logNode.textContent = `${line}\n${logNode.textContent}`;
  console.log(line);
}

function getAuthToken() {
  const token = localStorage.getItem(API_TOKEN_KEY)?.trim();
  return token || null;
}

function getAuthEmail() {
  const value = document.getElementById("auth_email").value?.trim();
  return value || "";
}

function updateAuthState() {
  const token = getAuthToken();
  authState.textContent = token ? `authenticated (${getAuthEmail() || "token"})` : "anonymous";
}

function authHeaders(base = {}) {
  const token = getAuthToken();
  if (!token) return base;
  return {
    ...base,
    authorization: `Bearer ${token}`,
  };
}

function getAuthFormValues() {
  return {
    nama: document.getElementById("auth_nama").value?.trim() ?? "",
    noIdentitasNelayan: document.getElementById("auth_no_identitas_nelayan").value?.trim() ?? "",
    email: getAuthEmail(),
    password: document.getElementById("auth_password").value ?? "",
  };
}

async function registerAuthUser() {
  const payload = getAuthFormValues();
  const response = await fetch(AUTH_REGISTER_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`register failed (${response.status}) ${detail}`);
  }

  return response.json();
}

async function loginAuthUser() {
  const payload = getAuthFormValues();
  const response = await fetch(AUTH_LOGIN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`login failed (${response.status}) ${detail}`);
  }

  const body = await response.json();
  if (!body?.token) {
    throw new Error("login response missing token");
  }

  localStorage.setItem(API_TOKEN_KEY, body.token);
  updateAuthState();
  return body;
}

async function logoutAuthUser() {
  await fetch(AUTH_LOGOUT_ENDPOINT, {
    method: "POST",
    headers: authHeaders(),
  }).catch(() => {});
  localStorage.removeItem(API_TOKEN_KEY);
  updateAuthState();
}

function updateNetworkState() {
  networkState.textContent = navigator.onLine ? "online" : "offline";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

function setPushToggleState({ enabled, disabled }) {
  if (disabled) {
    pushToggleButton.disabled = true;
    pushToggleButton.textContent = "Push Unsupported";
    return;
  }

  pushToggleButton.disabled = false;
  pushToggleButton.textContent = enabled ? "Disable Push" : "Enable Push";
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getPushSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function refreshPushToggle() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    setPushToggleState({ enabled: false, disabled: true });
    return;
  }

  const subscription = await getPushSubscription();
  setPushToggleState({ enabled: Boolean(subscription), disabled: false });
}

async function subscribePush() {
  if (!("PushManager" in window) || !("Notification" in window)) {
    throw new Error("push api unsupported in this browser");
  }

  log("push: requesting notification permission");
  const permission = await Notification.requestPermission();
  log(`push: notification permission result = ${permission}`);
  if (permission !== "granted") {
    throw new Error(`notification permission is ${permission}`);
  }

  log("push: fetching VAPID public key");
  const vapidResponse = await fetch(PUSH_VAPID_ENDPOINT, {
    headers: authHeaders(),
  });
  if (!vapidResponse.ok) {
    const detail = await vapidResponse.text().catch(() => "");
    throw new Error(`failed to fetch VAPID key (${vapidResponse.status}) ${detail}`);
  }

  const vapidPayload = await vapidResponse.json();
  const publicKey = vapidPayload.publicKey;
  if (!publicKey) {
    throw new Error("missing VAPID public key from backend");
  }

  log("push: resolving service worker registration");
  const reg = await navigator.serviceWorker.ready;
  log("push: checking existing subscription");
  let subscription = await withTimeout(
    reg.pushManager.getSubscription(),
    10000,
    "getSubscription",
  );
  if (!subscription) {
    log("push: creating browser subscription");
    subscription = await withTimeout(
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }),
      15000,
      "pushManager.subscribe",
    );
    log("push: browser subscription created");
  } else {
    log("push: existing browser subscription found");
  }

  log("push: sending subscription to backend");
  const subscribeResponse = await fetch(PUSH_SUBSCRIBE_ENDPOINT, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!subscribeResponse.ok) {
    const detail = await subscribeResponse.text().catch(() => "");
    throw new Error(`subscribe API failed (${subscribeResponse.status}) ${detail}`);
  }

  log("push enabled");
}

async function unsubscribePush() {
  const existing = await getPushSubscription();
  if (!existing) {
    log("push already disabled");
    return;
  }

  await fetch(PUSH_UNSUBSCRIBE_ENDPOINT, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ endpoint: existing.endpoint }),
  }).catch(() => {});

  await existing.unsubscribe();
  log("push disabled");
}

async function togglePush() {
  log("push toggle clicked");
  try {
    const subscription = await getPushSubscription();
    if (subscription) {
      await unsubscribePush();
    } else {
      await subscribePush();
    }
    await refreshPushToggle();
  } catch (err) {
    log(`push toggle failed: ${String(err)}`);
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "clientReportId" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueReport(report) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  await idbRequest(store.put(report));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  log(`queued report ${report.clientReportId}`);
}

async function getQueuedReports() {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const reports = await idbRequest(store.getAll());
  return reports.sort((a, b) => a.createdAtClient - b.createdAtClient);
}

async function removeQueuedReport(clientReportId) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  await idbRequest(store.delete(clientReportId));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function sendReport(report) {
  const response = await fetch(REPORT_ENDPOINT, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(report),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`report send failed (${response.status}) ${detail}`);
  }

  return response.json();
}

async function registerBackgroundSync() {
  if (!("serviceWorker" in navigator)) return false;

  const reg = await navigator.serviceWorker.ready;
  if (!("sync" in reg)) {
    return false;
  }

  try {
    await reg.sync.register(SYNC_TAG);
    log("background sync registered");
    return true;
  } catch (err) {
    log(`background sync registration failed: ${String(err)}`);
    return false;
  }
}

async function flushQueue(source) {
  const queued = await getQueuedReports();
  if (queued.length === 0) {
    log(`flush skipped (${source}): queue empty`);
    return;
  }

  log(`flush started (${source}): ${queued.length} queued`);

  for (const report of queued) {
    try {
      const result = await sendReport(report);
      await removeQueuedReport(report.clientReportId);
      if (result.status === "queued") {
        log(`synced (queued, waiting for threshold) ${report.clientReportId}`);
      } else {
        log(`synced + alert triggered ${report.clientReportId}`);
      }
    } catch (err) {
      log(`sync halted for ${report.clientReportId}: ${String(err)}`);
      break;
    }
  }
}

function buildReportFromForm() {
  const likCodesRaw = document.getElementById("lik_codes").value;
  const lik_codes = likCodesRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    lik_codes,
    beach_location: document.getElementById("beach_location").value.trim().toLowerCase(),
    clientReportId: crypto.randomUUID(),
    createdAtClient: Date.now(),
    observedAt: Date.now(),
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  let report;
  try {
    report = { ...buildReportFromForm(), reporterBrowserId: await getReporterBrowserId() };
  } catch (err) {
    log(`report could not be saved: ${String(err)}`);
    return;
  }

  if (!Array.isArray(report.lik_codes) || report.lik_codes.length === 0) {
    log("submit blocked: lik_codes is empty");
    return;
  }
  if (!report.beach_location) {
    log("submit blocked: beach_location is empty");
    return;
  }

  if (!navigator.onLine) {
    await queueReport(report);
    const syncRegistered = await registerBackgroundSync();
    if (!syncRegistered) {
      log("background sync unavailable; waiting for online/app-open flush");
    }
    return;
  }

  try {
    const result = await sendReport(report);
      if (result.status === "queued") {
        log(`report received (queued, waiting for threshold) ${report.clientReportId}`);
      } else {
        const re = result.alertEvent?.reassurance;
        const dec = result.alertEvent?.decision;
        const level = (dec?.final_risk_level || "UNKNOWN").toUpperCase();
        log(`alert triggered! ${report.clientReportId} → ${level} | SHAP=${re?.shapRisk || "-"} BMKG=${re?.bmkgRisk || "-"} XGB=${re?.xgboostLabel || "-"}(${re?.xgboostRisk ?? "-"}) fusion=${re?.finalLevel || "-"}`);
        if (result.alertEvent) showAlertPanel(result.alertEvent);
      }
  } catch (err) {
    log(`online send failed; queued ${report.clientReportId}: ${String(err)}`);
    await queueReport(report);
    const syncRegistered = await registerBackgroundSync();
    if (!syncRegistered) {
      log("background sync unavailable; waiting for online/app-open flush");
    }
  }
}

async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    log("service worker unsupported in this browser");
    return;
  }

  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  log("service worker ready");

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "SYNC_LOG") return;
    log(`sw: ${data.message}`);
  });
}

window.addEventListener("online", async () => {
  updateNetworkState();
  await flushQueue("online-event");
});

window.addEventListener("offline", () => {
  updateNetworkState();
  log("network offline");
});

authRegisterButton.addEventListener("click", () => {
  registerAuthUser()
    .then((result) => {
      log(`registered user ${result?.user?.email ?? "unknown"}`);
    })
    .catch((err) => {
      log(`register error: ${String(err)}`);
    });
});

authLoginButton.addEventListener("click", () => {
  loginAuthUser()
    .then((result) => {
      log(`logged in ${result?.user?.email ?? "unknown"}`);
    })
    .catch((err) => {
      log(`login error: ${String(err)}`);
    });
});

authLogoutButton.addEventListener("click", () => {
  logoutAuthUser()
    .then(() => {
      log("logged out");
    })
    .catch((err) => {
      log(`logout error: ${String(err)}`);
    });
});

flushNowButton.addEventListener("click", async () => {
  await flushQueue("manual");
});
pushToggleButton.addEventListener("click", () => {
  togglePush().catch((err) => {
    log(`push toggle unhandled error: ${String(err)}`);
  });
});

form.addEventListener("submit", (event) => {
  handleSubmit(event).catch((err) => {
    log(`submit error: ${String(err)}`);
  });
});

const RISK_COLORS = {
  normal: "#16a34a",
  waspada: "#f59e0b",
  siaga: "#ea580c",
  ekstrem: "#dc2626",
};

function showAlertPanel(alertEvent) {
  const panel = document.getElementById("alert-panel");
  const title = document.getElementById("alert-title");
  const body = document.getElementById("alert-body");
  if (!panel || !title || !body) return;

  const re = alertEvent.reassurance;
  const dec = alertEvent.decision;
  const level = (dec?.final_risk_level || "NORMAL").toUpperCase();
  const color = RISK_COLORS[level.toLowerCase()] || "#111";

  panel.style.display = "block";
  panel.style.borderColor = color;
  title.textContent = `PERINGATAN: ${level}`;
  title.style.color = color;

  const rows = [];
  rows.push(`<b>Lokasi:</b> ${alertEvent.beachLocation || "-"}`);
  rows.push(`<b>Waktu:</b> ${new Date(alertEvent.serverTimestamp).toLocaleString("id-ID")}`);
  rows.push(`<b>Pelapor:</b> ${alertEvent.reporterCount || 0} nelayan`);
  if (re) {
    rows.push(`<b>SHAP:</b> ${re.shapRisk || "-"}`);
    rows.push(`<b>BMKG:</b> ${re.bmkgRisk || "-"}`);
    rows.push(`<b>XGBoost:</b> ${re.xgboostLabel || "-"} (level ${re.xgboostRisk ?? "-"}) confidence ${re.details?.xgboost?.confidence ? (re.details.xgboost.confidence * 100).toFixed(1) + "%" : "-"}`);
    rows.push(`<b>Fusion:</b> ${re.finalLevel || "-"}`);
  }
  body.innerHTML = rows.join("<br>");
}

function connectAlertSse() {
  const token = getAuthToken();
  const sseUrl = token ? `/api/sse?token=${encodeURIComponent(token)}` : "/api/sse";
  const sse = new EventSource(sseUrl);

  sse.addEventListener("alert", (event) => {
    try {
      const payload = JSON.parse(event.data);
      showAlertPanel(payload);
      log(`alert received: ${payload.decision?.final_risk_level || "?"} @ ${payload.beachLocation}`);
    } catch (err) {
      log(`alert parse error: ${String(err)}`);
    }
  });

  sse.addEventListener("error", () => {
    sse.close();
    setTimeout(connectAlertSse, 5000);
  });
}

(async () => {
  window.addEventListener("error", (event) => {
    log(`window error: ${event.message}`);
  });

  updateAuthState();
  updateNetworkState();
  await setupServiceWorker();
  await refreshPushToggle();
  await flushQueue("app-open");
  connectAlertSse();
})();
