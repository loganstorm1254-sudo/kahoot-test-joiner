import { KahootJoiner } from "./kahoot-client.js";
import { generateRandomName, generateUniqueNames } from "./name-generator.js";

const pinInput = document.getElementById("pin");
const nameInput = document.getElementById("name");
const countSlider = document.getElementById("count");
const countLabel = document.getElementById("count-label");
const randomNamesCheck = document.getElementById("random-names");
const autoAnswerCheck = document.getElementById("auto-answer");
const joinButton = document.getElementById("join");
const disconnectButton = document.getElementById("disconnect");
const statusEl = document.getElementById("status");

let session = 0;
let joiners = [];
let targetCount = 0;
let joinedCount = 0;
let failedCount = 0;
let connected = false;
let lastError = "";

function getPlayerCount() {
  return Math.max(1, Math.min(100, Math.round(Number(countSlider.value))));
}

function updateCountLabel() {
  countLabel.textContent = String(getPlayerCount());
}

function setConnected(value) {
  connected = value;
  joinButton.disabled = value;
  disconnectButton.disabled = !value;
  pinInput.disabled = value;
  nameInput.disabled = value || randomNamesCheck.checked;
  countSlider.disabled = value;
  randomNamesCheck.disabled = value;
  autoAnswerCheck.disabled = value;
}

function setStatus(message) {
  statusEl.textContent = message;
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

function anyRunning() {
  return joiners.some((joiner) => joiner.isRunning());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildNicknames(count, baseName, useRandomNames) {
  if (useRandomNames) {
    return generateUniqueNames(count);
  }
  return Array.from({ length: count }, (_, index) => `${baseName}${index + 1}`);
}

async function startPlayers(activeSession, pin, nicknames, autoAnswer) {
  const delay = nicknames.length > 20 ? 150 : 700;

  for (let index = 0; index < nicknames.length; index += 1) {
    if (activeSession !== session) {
      return;
    }

    const nickname = nicknames[index];
    const joiner = new KahootJoiner();
    let joinTimeout;

    joiner.start({
      pin,
      nickname,
      autoAnswer,
      onJoined: () => {
        clearTimeout(joinTimeout);
        if (activeSession !== session) {
          return;
        }
        joinedCount += 1;
        updateBatchStatus();
      },
      onError: (message) => {
        clearTimeout(joinTimeout);
        if (activeSession !== session) {
          return;
        }
        lastError = message;
        failedCount += 1;
        updateBatchStatus();
      },
      onStatus: (message) => {
        if (activeSession !== session || targetCount !== 1) {
          return;
        }
        setStatus(message);
      },
    });

    joiners.push(joiner);

    joinTimeout = setTimeout(() => {
      if (activeSession !== session || joiner.joined) {
        return;
      }
      lastError = "Join timed out — is the PIN correct and the host running?";
      failedCount += 1;
      joiner.stop();
      updateBatchStatus();
    }, 20000);

    if (index < nicknames.length - 1) {
      await sleep(delay);
    }
  }
}

function onJoin() {
  if (connected || anyRunning()) {
    return;
  }

  const pin = pinInput.value.trim();
  const baseName = nameInput.value.trim();
  const count = getPlayerCount();
  const useRandomNames = randomNamesCheck.checked;
  const autoAnswer = autoAnswerCheck.checked;

  if (!/^\d{6,}$/.test(pin)) {
    alert("Please enter a valid Kahoot game PIN.");
    return;
  }

  if (!useRandomNames && !baseName) {
    alert("Please enter a base player name or enable random names.");
    return;
  }

  session += 1;
  const activeSession = session;
  targetCount = count;
  joinedCount = 0;
  failedCount = 0;
  lastError = "";
  joiners = [];

  const nicknames = buildNicknames(count, baseName || "test", useRandomNames);

  setConnected(true);
  setStatus(`Joining ${count} player${count === 1 ? "" : "s"}...`);
  startPlayers(activeSession, pin, nicknames, autoAnswer);
}

function onDisconnect() {
  session += 1;
  setConnected(false);
  setStatus("Disconnecting...");

  const activeJoiners = [...joiners];
  joiners = [];

  for (const joiner of activeJoiners) {
    joiner.stop();
  }

  setStatus("Disconnected");
}

function onRandomNamesToggle() {
  nameInput.disabled = randomNamesCheck.checked || connected;
  if (randomNamesCheck.checked) {
    nameInput.placeholder = generateRandomName();
  } else {
    nameInput.placeholder = "test";
  }
}

countSlider.addEventListener("input", updateCountLabel);
randomNamesCheck.addEventListener("change", onRandomNamesToggle);
joinButton.addEventListener("click", onJoin);
disconnectButton.addEventListener("click", onDisconnect);

updateCountLabel();
onRandomNamesToggle();
