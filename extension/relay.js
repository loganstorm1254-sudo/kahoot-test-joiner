const JOINER_ORIGINS = [
  "https://kahoot-test-joiner.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function isJoinerOrigin(origin) {
  if (JOINER_ORIGINS.includes(origin)) {
    return true;
  }
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:" && protocol !== "http:") {
      return false;
    }
    return (
      hostname === "kahoot-test-joiner.vercel.app" ||
      (hostname.endsWith(".vercel.app") && hostname.includes("kahoot-test-joiner"))
    );
  } catch {
    return false;
  }
}

function notifyReady(target, origin) {
  if (!target || !isJoinerOrigin(origin)) {
    return;
  }
  try {
    target.postMessage({ source: "blooket-relay", type: "READY" }, origin);
  } catch {
    // Ignore cross-origin opener edge cases.
  }
}

function broadcastReady() {
  if (!window.opener) {
    return;
  }
  for (const origin of JOINER_ORIGINS) {
    notifyReady(window.opener, origin);
  }
  try {
    const { origin } = new URL(document.referrer);
    notifyReady(window.opener, origin);
  } catch {
    // Ignore missing/invalid referrer.
  }
}

window.addEventListener("message", async (event) => {
  if (!isJoinerOrigin(event.origin) || !event.data || event.data.source !== "blooket-joiner") {
    return;
  }

  if (event.data.type === "PING") {
    event.source.postMessage({ source: "blooket-relay", type: "READY" }, event.origin);
    return;
  }

  if (event.data.type !== "JOIN" || !event.data.jobId) {
    return;
  }

  try {
    const response = await fetch("https://fb.blooket.com/c/firebase/join", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: String(event.data.id),
        name: String(event.data.name),
      }),
    });
    const text = await response.text();
    let result = {};
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = { success: false, msg: `Invalid response (${response.status})` };
    }
    if (!response.ok && response.status === 403) {
      result.success = false;
      result.msg = result.msg || "Blocked by Blooket (HTTP 403).";
    }
    result.httpStatus = response.status;
    event.source.postMessage(
      {
        source: "blooket-relay",
        type: "JOIN_RESULT",
        jobId: event.data.jobId,
        result,
      },
      event.origin,
    );
  } catch (error) {
    event.source.postMessage(
      {
        source: "blooket-relay",
        type: "JOIN_RESULT",
        jobId: event.data.jobId,
        result: { success: false, msg: error?.message || "Relay join failed." },
      },
      event.origin,
    );
  }
});

broadcastReady();
setInterval(broadcastReady, 500);

if (window.opener) {
  for (const origin of JOINER_ORIGINS) {
    notifyReady(window.opener, origin);
  }
}
