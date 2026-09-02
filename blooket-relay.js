const JOINER_REQUEST_EVENT = "blooket-joiner-request";
const EXTENSION_RELAY_EVENT = "blooket-extension-relay";
const RELAY_READY_TIMEOUT_MS = 20000;
const RELAY_JOIN_TIMEOUT_MS = 25000;

let relayReady = false;
const relayWaiters = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatchRequest(detail) {
  document.dispatchEvent(
    new CustomEvent(JOINER_REQUEST_EVENT, {
      detail: { source: "blooket-joiner", ...detail },
    }),
  );
}

function ensureRelayListener() {
  if (ensureRelayListener.installed) {
    return;
  }
  ensureRelayListener.installed = true;

  document.addEventListener(EXTENSION_RELAY_EVENT, (event) => {
    const data = event.detail;
    if (!data || data.source !== "blooket-relay") {
      return;
    }

    if (data.type === "READY") {
      relayReady = true;
      return;
    }

    if (data.type !== "JOIN_RESULT" || !data.jobId) {
      return;
    }

    const waiter = relayWaiters.get(data.jobId);
    if (!waiter) {
      return;
    }
    relayWaiters.delete(data.jobId);
    clearTimeout(waiter.timeoutId);
    waiter.resolve(data.result || { success: false, msg: "Empty relay response." });
  });
}

export async function waitForBlooketRelay(timeoutMs = RELAY_READY_TIMEOUT_MS) {
  ensureRelayListener();
  relayReady = false;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (relayReady) {
      return true;
    }
    dispatchRequest({ type: "PING" });
    await sleep(300);
  }

  return relayReady;
}

function joinOneViaRelay(gameId, name) {
  return new Promise((resolve, reject) => {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutId = setTimeout(() => {
      relayWaiters.delete(jobId);
      reject(new Error("Relay join timed out."));
    }, RELAY_JOIN_TIMEOUT_MS);

    relayWaiters.set(jobId, { resolve, reject, timeoutId });
    dispatchRequest({
      type: "JOIN",
      jobId,
      id: gameId,
      name,
    });
  });
}

export async function requestBlooketJoinsViaRelay(gameId, names) {
  const ready = await waitForBlooketRelay();
  if (!ready) {
    throw new Error(
      "Blooket helper not connected. Install the one-time Chrome extension (see setup below), reload this page, then try again.",
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
