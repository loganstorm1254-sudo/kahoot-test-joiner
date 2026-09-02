const BLOOKET_ORIGIN = "https://play.blooket.com";
const RELAY_READY_TIMEOUT_MS = 20000;
const RELAY_JOIN_TIMEOUT_MS = 25000;

let relayWindow = null;
let relayReady = false;
const relayWaiters = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureRelayListener() {
  if (ensureRelayListener.installed) {
    return;
  }
  ensureRelayListener.installed = true;

  window.addEventListener("message", (event) => {
    if (event.origin !== BLOOKET_ORIGIN || !event.data || event.data.source !== "blooket-relay") {
      return;
    }

    if (event.data.type === "READY") {
      relayReady = true;
      return;
    }

    if (event.data.type !== "JOIN_RESULT" || !event.data.jobId) {
      return;
    }

    const waiter = relayWaiters.get(event.data.jobId);
    if (!waiter) {
      return;
    }
    relayWaiters.delete(event.data.jobId);
    clearTimeout(waiter.timeoutId);
    waiter.resolve(event.data.result || { success: false, msg: "Empty relay response." });
  });
}

export function openBlooketRelayWindow(gameId) {
  ensureRelayListener();
  relayReady = false;

  const url = `https://play.blooket.com/play?id=${encodeURIComponent(gameId)}`;
  if (relayWindow && !relayWindow.closed) {
    try {
      relayWindow.location.href = url;
      relayWindow.focus();
      return relayWindow;
    } catch {
      relayWindow = null;
    }
  }

  relayWindow = window.open(url, "blooket_join_relay", "width=1,height=1,left=-9999,top=-9999");
  return relayWindow;
}

export async function waitForBlooketRelay(timeoutMs = RELAY_READY_TIMEOUT_MS) {
  ensureRelayListener();
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (relayReady && relayWindow && !relayWindow.closed) {
      return true;
    }
    if (relayWindow && !relayWindow.closed) {
      relayWindow.postMessage({ source: "blooket-joiner", type: "PING" }, BLOOKET_ORIGIN);
    }
    await sleep(300);
  }

  return relayReady;
}

function joinOneViaRelay(gameId, name) {
  return new Promise((resolve, reject) => {
    if (!relayWindow || relayWindow.closed) {
      reject(new Error("Blooket relay window is closed."));
      return;
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutId = setTimeout(() => {
      relayWaiters.delete(jobId);
      reject(new Error("Relay join timed out."));
    }, RELAY_JOIN_TIMEOUT_MS);

    relayWaiters.set(jobId, { resolve, reject, timeoutId });
    relayWindow.postMessage(
      {
        source: "blooket-joiner",
        type: "JOIN",
        jobId,
        id: gameId,
        name,
      },
      BLOOKET_ORIGIN,
    );
  });
}

export async function requestBlooketJoinsViaRelay(gameId, names) {
  openBlooketRelayWindow(gameId);

  const ready = await waitForBlooketRelay();
  if (!ready) {
    throw new Error(
      "Blooket helper not connected. Install the one-time Chrome extension (see link above), allow popups, then try again.",
    );
  }

  const joins = [];
  for (const name of names) {
    const result = await joinOneViaRelay(gameId, name);
    joins.push({ name, ...result });
    await sleep(150);
  }

  const successCount = joins.filter((entry) => entry.success).length;
  return {
    success: successCount > 0,
    joins,
    successCount,
    totalCount: joins.length,
    msg:
      successCount === joins.length
        ? undefined
        : successCount === 0
          ? joins[0]?.msg || "Could not join that game."
          : `Joined ${successCount}/${joins.length} players.`,
  };
}
