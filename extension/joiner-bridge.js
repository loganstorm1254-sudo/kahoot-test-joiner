const JOINER_REQUEST_EVENT = "blooket-joiner-request";
const EXTENSION_RELAY_EVENT = "blooket-extension-relay";

function relayToPage(detail) {
  document.dispatchEvent(new CustomEvent(EXTENSION_RELAY_EVENT, { detail }));
}

function announceReady() {
  relayToPage({ source: "blooket-relay", type: "READY" });
}

document.addEventListener(JOINER_REQUEST_EVENT, async (event) => {
  const data = event.detail;
  if (!data || data.source !== "blooket-joiner") {
    return;
  }

  if (data.type === "PING") {
    try {
      await chrome.runtime.sendMessage({ type: "PING" });
      announceReady();
    } catch {
      // Extension background unavailable.
    }
    return;
  }

  if (data.type !== "JOIN" || !data.jobId) {
    return;
  }

  let result = { success: false, msg: "Extension background unavailable." };
  try {
    result = await chrome.runtime.sendMessage({
      type: "JOIN",
      id: data.id,
      name: data.name,
    });
  } catch (error) {
    result = { success: false, msg: error?.message || "Relay join failed." };
  }

  relayToPage({
    source: "blooket-relay",
    type: "JOIN_RESULT",
    jobId: data.jobId,
    result,
  });
});

announceReady();
setInterval(announceReady, 500);
