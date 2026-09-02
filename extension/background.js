async function joinBlooketGame({ id, name }) {
  const response = await fetch("https://fb.blooket.com/c/firebase/join", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: String(id),
      name: String(name),
    }),
  });

  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { success: false, msg: `Invalid response (${response.status})` };
  }

  if (!response.ok) {
    result.success = false;
    if (response.status === 403) {
      result.msg = result.msg || "Blocked by Blooket (HTTP 403).";
    } else if (!result.msg) {
      result.msg = `Join request failed (HTTP ${response.status}).`;
    }
  }

  result.httpStatus = response.status;
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "JOIN") {
    joinBlooketGame(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, msg: error?.message || "Relay join failed." }));
    return true;
  }

  return false;
});
