import {
  BlooketJoiner,
  isValidBlooketGameId,
  normalizeBlooketGameId,
  requestBlooketJoins,
} from "./blooket-client.js";
import { BLOOKET_SECRET_CODE, isBlooketSecretCode } from "./blooket-shared.js";
import { generateRandomName, generateUniqueNames } from "./name-generator.js";

const MAX_PLAYERS = 44;

let session = 0;
let joiners = [];
let connected = false;

let gameIdInput;
let nameInput;
let countSlider;
let countInput;
let randomNamesCheck;
let autoAnswerCheck;
let joinButton;
let disconnectButton;
let statusEl;
let activityLogEl;

export function initBlooketJoiner(root = document) {
  gameIdInput = root.getElementById("blooket-pin");
  nameInput = root.getElementById("blooket-name");
  countSlider = root.getElementById("blooket-count");
  countInput = root.getElementById("blooket-count-input");
  randomNamesCheck = root.getElementById("blooket-random-names");
  autoAnswerCheck = root.getElementById("blooket-auto-answer");
  joinButton = root.getElementById("blooket-join");
  disconnectButton = root.getElementById("blooket-disconnect");
  statusEl = root.getElementById("blooket-status");
  activityLogEl = root.getElementById("blooket-activity-log");

  if (!joinButton) {
    return;
  }

  setPlayerCount(1);
  onRandomNamesToggle();

  countSlider?.addEventListener("input", () => setPlayerCount(countSlider.value));
  countInput?.addEventListener("change", () => setPlayerCount(countInput.value));
  randomNamesCheck?.addEventListener("change", onRandomNamesToggle);
  joinButton.addEventListener("click", onJoin);
  disconnectButton?.addEventListener("click", onDisconnect);
  root.getElementById("blooket-clear-log")?.addEventListener("click", () => clearBlooketLog());
}

function clampPlayerCount(value) {
  return Math.max(1, Math.min(MAX_PLAYERS, Math.round(Number(value)) || 1));
}

function setPlayerCount(value) {
  const count = clampPlayerCount(value);
  if (countSlider) {
    countSlider.value = String(count);
  }
  if (countInput) {
    countInput.value = String(count);
  }
}

function getPlayerCount() {
  return clampPlayerCount(countInput?.value || countSlider?.value || 1);
}

function setConnected(value) {
  connected = value;
  if (joinButton) {
    joinButton.disabled = value;
  }
  if (disconnectButton) {
    disconnectButton.disabled = !value;
  }
  if (gameIdInput) {
    gameIdInput.disabled = value;
  }
  if (nameInput) {
    nameInput.disabled = value || randomNamesCheck?.checked;
  }
  if (countSlider) {
    countSlider.disabled = value;
  }
  if (countInput) {
    countInput.disabled = value;
  }
  if (randomNamesCheck) {
    randomNamesCheck.disabled = value;
  }
  if (autoAnswerCheck) {
    autoAnswerCheck.disabled = value;
  }
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function clearBlooketLog() {
  if (activityLogEl) {
    activityLogEl.textContent = "";
  }
}

function logActivity(message, { level = "info", source = "system" } = {}) {
  if (!activityLogEl) {
    return;
  }
  const line = document.createElement("div");
  line.className = `log-line log-line-${level}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  line.textContent = `[${time}] ${source} — ${message}`;
  activityLogEl.appendChild(line);
  activityLogEl.scrollTop = activityLogEl.scrollHeight;
}

function buildNicknames(count, baseName, useRandomNames) {
  if (useRandomNames) {
    return generateUniqueNames(count);
  }
  return Array.from({ length: count }, (_, index) => `${baseName}${index + 1}`);
}

async function onJoin() {
  if (connected) {
    return;
  }

  const gameId = normalizeBlooketGameId(gameIdInput?.value);
  const baseName = nameInput?.value.trim() || "bot";
  const count = getPlayerCount();
  const useRandomNames = Boolean(randomNamesCheck?.checked);
  const autoAnswer = Boolean(autoAnswerCheck?.checked);

  if (!isValidBlooketGameId(gameId)) {
    alert("Enter a valid 5–7 digit Blooket game ID.");
    return;
  }

  session += 1;
  const activeSession = session;
  joiners = [];
  clearBlooketLog();

  const nicknames = buildNicknames(count, baseName, useRandomNames);
  setConnected(true);
  setStatus(`Joining ${count} player${count === 1 ? "" : "s"}… (first join can take ~30s)`);
  logActivity(`Starting Blooket batch: ${count} player${count === 1 ? "" : "s"}, game ${gameId}`);

  try {
    const batch = await requestBlooketJoins(gameId, nicknames);
    if (activeSession !== session) {
      return;
    }

    let joinedCount = 0;
    let failedCount = 0;

    for (const entry of batch.joins) {
      if (activeSession !== session) {
        return;
      }

      if (!entry.success) {
        failedCount += 1;
        logActivity(entry.msg || "Could not join that game.", { source: entry.name, level: "error" });
        continue;
      }

      const joiner = new BlooketJoiner();
      const ok = await joiner.connect({
        gameId,
        nickname: entry.name,
        joinData: entry,
        autoAnswer,
        onJoined: () => {
          joinedCount += 1;
          setStatus(`Joined ${joinedCount}/${count} players`);
        },
        onError: (message) => {
          failedCount += 1;
          logActivity(message, { source: entry.name, level: "error" });
        },
        onStatus: (message) => logActivity(message, { source: entry.name }),
        onActivity: ({ steps }) => {
          for (const step of steps || []) {
            logActivity(step?.message || String(step), {
              source: entry.name,
              level: step?.level || "info",
            });
          }
        },
      });

      if (ok) {
        joiners.push(joiner);
      }
    }

    if (joinedCount === count) {
      setStatus(`Joined ${joinedCount} player${joinedCount === 1 ? "" : "s"} — check the host lobby`);
    } else if (joinedCount > 0) {
      setStatus(`Joined ${joinedCount}/${count} players (${failedCount} failed)`);
    } else {
      setStatus(batch.msg || "Failed to join");
    }
  } catch (error) {
    if (activeSession === session) {
      logActivity(error.message || "Join failed.", { level: "error" });
      setStatus(error.message || "Join failed.");
    }
  } finally {
    if (activeSession === session) {
      setConnected(joiners.length > 0);
    }
  }
}

function onDisconnect() {
  session += 1;
  setConnected(false);
  setStatus("Disconnecting...");
  for (const joiner of joiners) {
    joiner.stop();
  }
  joiners = [];
  setStatus("Disconnected");
}

function onRandomNamesToggle() {
  if (!nameInput || !randomNamesCheck) {
    return;
  }
  nameInput.disabled = randomNamesCheck.checked || connected;
  if (randomNamesCheck.checked) {
    nameInput.placeholder = generateRandomName();
  } else {
    nameInput.placeholder = "bot";
  }
}

export { BLOOKET_SECRET_CODE, isBlooketSecretCode } from "./blooket-shared.js";
