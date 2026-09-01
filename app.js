import { KahootJoiner } from "./kahoot-client.js";
import { generateRandomName, generateUniqueNames } from "./name-generator.js";
import {
  clearLearnedAnswers,
  clearQuizCache,
  getCachedQuizAnswers,
  isValidPin,
  normalizePin,
  prefetchQuizAnswers,
} from "./quiz-answers.js";

const pinInput = document.getElementById("pin");
const nameInput = document.getElementById("name");
const countSlider = document.getElementById("count");
const countLabel = document.getElementById("count-label");
const randomNamesCheck = document.getElementById("random-names");
const autoAnswerCheck = document.getElementById("auto-answer");
const joinButton = document.getElementById("join");
const disconnectButton = document.getElementById("disconnect");
const statusEl = document.getElementById("status");
const quizResultEl = document.getElementById("quiz-result");

let session = 0;
let joiners = [];
let targetCount = 0;
let joinedCount = 0;
let failedCount = 0;
let connected = false;
let lastError = "";
let prefetchTimer = null;
let prefetchRetryTimer = null;
let lastPrefetchedPin = "";
let gameEndResults = [];

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

function setQuizResult(message) {
  quizResultEl.textContent = message;
  quizResultEl.hidden = !message;
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

function formatPrefetchStatus(pin, quizAnswers) {
  if (!isValidPin(pin)) {
    return "Enter a PIN to join";
  }
  if (!autoAnswerCheck.checked) {
    return "Enter PIN and click Enter to join";
  }
  if (quizAnswers?.answers?.length) {
    const title = quizAnswers.title ? ` (“${quizAnswers.title}”)` : "";
    return `${quizAnswers.answers.length} answers ready${title} — click Enter when the host starts`;
  }
  return "Fetching quiz answers in the background… (start the host game if this stays empty)";
}

async function refreshPrefetchStatus(pin, { force = false } = {}) {
  if (!autoAnswerCheck.checked || !isValidPin(pin) || connected) {
    return null;
  }

  const quizAnswers = await prefetchQuizAnswers(pin, { force });
  if (!connected) {
    setStatus(formatPrefetchStatus(pin, quizAnswers));
  }
  return quizAnswers;
}

function schedulePrefetch(pin) {
  const normalizedPin = normalizePin(pin);
  if (prefetchTimer) {
    clearTimeout(prefetchTimer);
  }

  prefetchTimer = setTimeout(() => {
    prefetchTimer = null;
    if (connected || !autoAnswerCheck.checked) {
      return;
    }

    if (!isValidPin(normalizedPin)) {
      setStatus("Enter a PIN to join");
      return;
    }

    if (normalizedPin !== lastPrefetchedPin) {
      clearQuizCache(lastPrefetchedPin);
      lastPrefetchedPin = normalizedPin;
    }

    refreshPrefetchStatus(normalizedPin);
  }, 350);
}

function startPrefetchRetryLoop() {
  stopPrefetchRetryLoop();
  prefetchRetryTimer = setInterval(() => {
    if (connected || !autoAnswerCheck.checked) {
      return;
    }
    const pin = normalizePin(pinInput.value);
    if (!isValidPin(pin)) {
      return;
    }
    const cached = getCachedQuizAnswers(pin);
    if (cached?.answers?.length) {
      setStatus(formatPrefetchStatus(pin, cached));
      return;
    }
    refreshPrefetchStatus(pin, { force: true });
  }, 8000);
}

function stopPrefetchRetryLoop() {
  if (prefetchRetryTimer) {
    clearInterval(prefetchRetryTimer);
    prefetchRetryTimer = null;
  }
}

function updateQuizEndSummary(activeSession) {
  if (activeSession !== session || gameEndResults.length === 0) {
    return;
  }

  const winners = gameEndResults.filter((result) => result.won);
  const finishedCount = gameEndResults.length;
  const expected = joinedCount;

  if (winners.length > 0) {
    const lines = winners.map(
      (winner) =>
        `${winner.nickname} — rank #${winner.rank ?? 1}, ${winner.totalScore} pts (${winner.correctCount} correct)`,
    );
    setQuizResult(`Your bot won! ${lines.join(" · ")}`);
    setStatus(`Quiz finished — ${finishedCount}/${expected} bots reported`);
    return;
  }

  if (expected > 0 && finishedCount >= expected) {
    const best = [...gameEndResults].sort((left, right) => {
      const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return right.totalScore - left.totalScore;
    })[0];

    if (best) {
      setQuizResult(
        `None of your bots won. Best: ${best.nickname} — rank #${best.rank ?? "?"}, ${best.totalScore} pts`,
      );
    } else {
      setQuizResult("Quiz finished — none of your bots won.");
    }
    setStatus(`Quiz finished — ${finishedCount}/${expected} bots reported`);
    return;
  }

  setStatus(`Quiz ending… ${finishedCount}/${expected || "?"} bots reported`);
}

async function startPlayers(activeSession, pin, nicknames, autoAnswer) {
  const delay = nicknames.length > 20 ? 150 : 700;
  let quizAnswers = getCachedQuizAnswers(pin);

  if (autoAnswer) {
    if (!quizAnswers?.answers?.length) {
      setStatus("Loading quiz answers…");
      quizAnswers = await prefetchQuizAnswers(pin, { force: true });
    }
    if (activeSession !== session) {
      return;
    }
    if (quizAnswers?.answers?.length) {
      setStatus(`Loaded ${quizAnswers.answers.length} answers — joining ${nicknames.length} players…`);
    } else {
      setStatus(`Quiz answers unavailable — joining ${nicknames.length} players (random guesses)…`);
    }
  }

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
      quizAnswers,
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
      onGameEnd: (result) => {
        if (activeSession !== session) {
          return;
        }
        if (!gameEndResults.some((entry) => entry.nickname === result.nickname)) {
          gameEndResults.push(result);
        }
        updateQuizEndSummary(activeSession);
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

  if (!isValidPin(pin)) {
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
  gameEndResults = [];
  setQuizResult("");
  clearLearnedAnswers(pin);
  stopPrefetchRetryLoop();

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
  startPrefetchRetryLoop();
  schedulePrefetch(pinInput.value);
}

function onRandomNamesToggle() {
  nameInput.disabled = randomNamesCheck.checked || connected;
  if (randomNamesCheck.checked) {
    nameInput.placeholder = generateRandomName();
  } else {
    nameInput.placeholder = "test";
  }
}

function onPinInput() {
  if (connected) {
    return;
  }
  schedulePrefetch(pinInput.value);
}

function onAutoAnswerToggle() {
  if (connected) {
    return;
  }
  if (autoAnswerCheck.checked) {
    startPrefetchRetryLoop();
    schedulePrefetch(pinInput.value);
  } else {
    stopPrefetchRetryLoop();
    setStatus("Enter PIN and click Enter to join");
  }
}

countSlider.addEventListener("input", updateCountLabel);
randomNamesCheck.addEventListener("change", onRandomNamesToggle);
autoAnswerCheck.addEventListener("change", onAutoAnswerToggle);
pinInput.addEventListener("input", onPinInput);
pinInput.addEventListener("blur", onPinInput);
joinButton.addEventListener("click", onJoin);
disconnectButton.addEventListener("click", onDisconnect);

updateCountLabel();
onRandomNamesToggle();
startPrefetchRetryLoop();
schedulePrefetch(pinInput.value);
