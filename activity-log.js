const activityLogEl = document.getElementById("activity-log");
const MAX_LOG_LINES = 250;

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function createLogLine(level, source, message) {
  const line = document.createElement("div");
  line.className = `log-line log-line-${level}`;
  const prefix = source ? `[${formatTime()}] ${source}` : `[${formatTime()}]`;
  line.textContent = `${prefix} — ${message}`;
  return line;
}

export function clearActivityLog() {
  if (activityLogEl) {
    activityLogEl.textContent = "";
  }
}

export function appendActivityLog(message, { level = "info", source = "system" } = {}) {
  if (!activityLogEl || !message) {
    return;
  }

  const text = String(message).trim();
  if (!text) {
    return;
  }

  activityLogEl.appendChild(createLogLine(level, source, text));

  while (activityLogEl.children.length > MAX_LOG_LINES) {
    activityLogEl.removeChild(activityLogEl.firstChild);
  }

  activityLogEl.scrollTop = activityLogEl.scrollHeight;
}

export function appendActivitySteps(steps, { source = "search" } = {}) {
  if (!Array.isArray(steps)) {
    return;
  }
  for (const step of steps) {
    const level = step?.level || "info";
    appendActivityLog(step?.message || String(step), { level, source });
  }
}
