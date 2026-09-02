import { BlooketJoiner, isValidBlooketGameId, normalizeBlooketGameId } from "./blooket-client.js";
import { generateRandomName, generateUniqueNames } from "./name-generator.js";

const BLOOKET_SECRET_CODE = "1254";
const MAX_CONCURRENT_JOINS = 4;
const JOIN_TIMEOUT_MS = 30000;
const JOIN_RETRY_ATTEMPTS = 2;
const JOIN_LAUNCH_DELAY_MS = 350;
const MAX_PLAYERS = 44;

let session = 0;
let joiners = [];
let targetCount = 0;
let joinedCount = 0;
let failedCount = 0;
let connected = false;
let lastError = "";

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

function logSteps(steps, source) {
  if (!Array.isArray(steps)) {
    return;
  }
  for (const step of steps) {
    logActivity(step?.message || String(step), { level: step?.level || "info", source });
  }
}

function buildNicknames(count, baseName, useRandomNames) {
  if (useRandomNames) {
    return generateUniqueNames(count);
  }
  return Array.from({ length: count }, (_, index) => `${baseName}${index + 1}`);
}

function updateBatchStatus() {
  if (targetCount === 1) {
    if (joinedCount === 1) {
      setStatus("Joined 1 player — check the host lobby");
    } else if (failedCount === 1) {
      setStatus(lastError || "Failed to join");
    } else {
      setStatus("Joining...");
    }
    return;
  }
  let message = `Joined ${joinedCount}/${targetCount} players`;
  if (failedCount > 0) {
    message += ` (${failedCount} failed)`;
    if (lastError) {
      message += `: ${lastError}`;
    }
  }
  setStatus(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attemptJoin(activeSession, gameId, nickname, autoAnswer) {
  return new Promise((resolve) => {
    const joiner = new BlooketJoiner();
    let settled = false;
    let joinTimeout;

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(joinTimeout);
      resolve({ joiner, ...result });
    };

    joiner.start({
      gameId,
      nickname,
      autoAnswer,
      onJoined: () => {
        if (activeSession !== session) {
          settle({ success: false, aborted: true });
          return;
        }
        joinedCount += 1;
        updateBatchStatus();
        settle({ success: true });
      },
      onError: (message) => {
        if (activeSession !== session) {
          settle({ success: false, aborted: true });
          return;
        }
        logActivity(message, { source: nickname, level: "error" });
        settle({ success: false, message });
      },
      onStatus: (message) => {
        if (activeSession !== session) {
          return;
        }
        logActivity(message, { source: nickname });
        if (targetCount === 1) {
          setStatus(message);
        }
      },
      onActivity: ({ steps }) => {
        if (activeSession !== session) {
          return;
        }
        logSteps(steps, nickname);
      },
    });

    joinTimeout = setTimeout(() => {
      if (joiner.joined) {
        settle({ success: true });
        return;
      }
      joiner.stop();
      settle({ success: false, message: "Join timed out" });
    }, JOIN_TIMEOUT_MS);
  });
}

async function joinPlayerWithRetry(activeSession, gameId, nickname, autoAnswer) {
  for (let attempt = 1; attempt <= JOIN_RETRY_ATTEMPTS; attempt += 1) {
    if (activeSession !== session) {
      return null;
    }
    const result = await attemptJoin(activeSession, gameId, nickname, autoAnswer);
    if (activeSession !== session || result.aborted) {
      return null;
    }
    if (result.success) {
      return result.joiner;
    }
    lastError = result.message || "Failed to join";
    if (attempt < JOIN_RETRY_ATTEMPTS) {
      await sleep(JOIN_LAUNCH_DELAY_MS * attempt);
    } else {
      failedCount += 1;
      updateBatchStatus();
      return null;
    }
  }
  return null;
}

async function startPlayers(activeSession, gameId, nicknames, autoAnswer) {
  let nextIndex = 0;
  let inFlight = 0;

  await new Promise((resolveAll) => {
    const pump = () => {
      if (activeSession !== session) {
        resolveAll();
        return;
      }

      while (inFlight < MAX_CONCURRENT_JOINS && nextIndex < nicknames.length) {
        const nickname = nicknames[nextIndex];
        nextIndex += 1;
        inFlight += 1;

        joinPlayerWithRetry(activeSession, gameId, nickname, autoAnswer)
          .then((joiner) => {
            if (joiner) {
              joiners.push(joiner);
            }
          })
          .finally(async () => {
            inFlight -= 1;
            if (activeSession !== session) {
              resolveAll();
              return;
            }
            if (nextIndex < nicknames.length) {
              await sleep(JOIN_LAUNCH_DELAY_MS);
            }
            if (nextIndex >= nicknames.length && inFlight === 0) {
              resolveAll();
            } else {
              pump();
            }
          });
      }

      if (nextIndex >= nicknames.length && inFlight === 0) {
        resolveAll();
      }
    };

    pump();
  });
}

function onJoin() {
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
  targetCount = count;
  joinedCount = 0;
  failedCount = 0;
  lastError = "";
  joiners = [];
  clearBlooketLog();

  const nicknames = buildNicknames(count, baseName, useRandomNames);
  logActivity(`Starting Blooket batch: ${count} player${count === 1 ? "" : "s"}, game ${gameId}`);
  setConnected(true);
  setStatus(`Joining ${count} player${count === 1 ? "" : "s"}...`);
  startPlayers(activeSession, gameId, nicknames, autoAnswer);
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

export function isBlooketSecretCode(value) {
  return normalizeBlooketGameId(value) === BLOOKET_SECRET_CODE;
}

export { BLOOKET_SECRET_CODE };
