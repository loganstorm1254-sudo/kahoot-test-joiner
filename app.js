import { KahootJoiner } from "./kahoot-client.js";
import { generateRandomName, generateUniqueNames } from "./name-generator.js";
import {
  clearLearnedAnswers,
  clearQuizCache,
  fetchQuizByTitle,
  formatPinForDisplay,
  getCachedQuizAnswers,
  isValidPin,
  normalizePin,
  prefetchQuizAnswers,
  rememberCorrectChoices,
} from "./quiz-answers.js";
import { CLIENT_BUILD } from "./version.js";
import { appendActivityLog, appendActivitySteps, clearActivityLog } from "./activity-log.js";

const pinInput = document.getElementById("pin");
const nameInput = document.getElementById("name");
const countSlider = document.getElementById("count");
const countInput = document.getElementById("count-input");
const randomNamesCheck = document.getElementById("random-names");
const autoAnswerCheck = document.getElementById("auto-answer");
const joinButton = document.getElementById("join");
const disconnectButton = document.getElementById("disconnect");
const statusEl = document.getElementById("status");
const quizResultEl = document.getElementById("quiz-result");
const versionInfoEl = document.getElementById("version-info");

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
let sharedQuizAnswers = null;
let sharedQuizLoadPromise = null;
let loadedVersion = "";
let latestVersion = "";
const MAX_CONCURRENT_JOINS = 4;
const JOIN_TIMEOUT_MS = 45000;
const JOIN_RETRY_ATTEMPTS = 2;
const JOIN_LAUNCH_DELAY_MS = 400;

const MAX_PLAYERS = 44;

function clampPlayerCount(value) {
  return Math.max(1, Math.min(MAX_PLAYERS, Math.round(Number(value)) || 1));
}

function setPlayerCount(value) {
  const count = clampPlayerCount(value);
  countSlider.value = String(count);
  countInput.value = String(count);
}

function getPlayerCount() {
  return clampPlayerCount(countInput.value || countSlider.value);
}

function setConnected(value) {
  connected = value;
  joinButton.disabled = value;
  disconnectButton.disabled = !value;
  pinInput.disabled = value;
  nameInput.disabled = value || randomNamesCheck.checked;
  countSlider.disabled = value;
  countInput.disabled = value;
  randomNamesCheck.disabled = value;
  autoAnswerCheck.disabled = value;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setImportantStatus(message) {
  setStatus(message);
}

function renderVersionInfo() {
  if (!versionInfoEl) {
    return;
  }

  if (!loadedVersion) {
    versionInfoEl.textContent = `Loading version… · ${CLIENT_BUILD}`;
    versionInfoEl.className = "version-info";
    return;
  }

  const stale = latestVersion && loadedVersion && latestVersion !== loadedVersion;
  versionInfoEl.className = stale ? "version-info is-stale" : "version-info is-current";
  versionInfoEl.textContent = stale
    ? `Update available: latest is ${latestVersion}, you have ${loadedVersion}. Hard refresh the page. · ${CLIENT_BUILD}`
    : `You are on the newest version: ${loadedVersion} · ${CLIENT_BUILD}`;
}

async function fetchLatestVersion() {
  const response = await fetch(`/api/version?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Version check failed (${response.status})`);
  }
  return response.json();
}

async function checkForUpdates({ initial = false } = {}) {
  try {
    const info = await fetchLatestVersion();
    latestVersion = info.version || "unknown";
    if (initial || !loadedVersion) {
      loadedVersion = latestVersion;
    }
    renderVersionInfo();
    return info;
  } catch {
    if (versionInfoEl) {
      versionInfoEl.textContent = `Version check failed · ${CLIENT_BUILD}`;
      versionInfoEl.className = "version-info is-stale";
    }
    return null;
  }
}

function resetSharedQuizAnswers() {
  sharedQuizAnswers = null;
  sharedQuizLoadPromise = null;
}

function setQuizResult(message, { winner = false } = {}) {
  quizResultEl.textContent = message;
  quizResultEl.hidden = !message;
  quizResultEl.classList.toggle("is-winner", winner);
  if (message) {
    quizResultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
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
  return "Answers load automatically when the host starts the quiz";
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
        `${winner.nickname} — #${winner.rank ?? 1}, ${winner.totalScore} pts (${winner.correctCount} correct)`,
    );
    setQuizResult(`Winner: ${lines.join(" · ")}`, { winner: true });
    setStatus(`Quiz finished — ${finishedCount}/${expected} bots reported`);
    return;
  }

  const best = [...gameEndResults].sort((left, right) => {
    const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return right.totalScore - left.totalScore;
  })[0];

  if (!best) {
    return;
  }

  if (expected > 0 && finishedCount >= expected) {
    setQuizResult(
      `Quiz over. Best bot: ${best.nickname} — rank #${best.rank ?? "?"}, ${best.totalScore} pts (${best.correctCount} correct)`,
    );
    setStatus(`Quiz finished — ${finishedCount}/${expected} bots reported`);
    return;
  }

  setQuizResult(
    `Results coming in… Best so far: ${best.nickname} — rank #${best.rank ?? "?"}, ${best.totalScore} pts`,
  );
  setStatus(`Quiz ending… ${finishedCount}/${expected || "?"} bots reported`);
}

async function applyQuizAnswersToAll(joinersList, quizAnswers) {
  if (!quizAnswers?.answers?.length && !quizAnswers?.answersByBlockIndex?.length) {
    return;
  }
  for (const joiner of joinersList) {
    joiner.applyQuizAnswers(quizAnswers);
  }
}

async function ensureQuizAnswers(pin, title, choiceCounts, quizId, activeSession) {
  if (!choiceCounts?.length || activeSession !== session) {
    return null;
  }

  if (sharedQuizAnswers?.answers?.length) {
    return sharedQuizAnswers;
  }

  const cached = getCachedQuizAnswers(pin);
  if (cached?.answers?.length) {
    sharedQuizAnswers = cached;
    await applyQuizAnswersToAll(joiners, cached);
    return cached;
  }

  if (!sharedQuizLoadPromise) {
    sharedQuizLoadPromise = (async () => {
      const lookupLabel = title ? `“${title}”` : "quiz layout";
      setImportantStatus(`Looking up answers for ${lookupLabel}…`);

      const fetched = await fetchQuizByTitle(title, choiceCounts, pin, quizId);
      if (activeSession !== session) {
        return null;
      }

      if (fetched?.answers?.length) {
        sharedQuizAnswers = fetched;
        await applyQuizAnswersToAll(joiners, fetched);
        setImportantStatus(
          `Smart mode: ${fetched.answers.length} answers loaded for “${fetched.title || title || "quiz"}”`,
        );
        return fetched;
      }

      setImportantStatus(
        title
          ? `Private or unknown quiz “${title}” — learning answers after each reveal`
          : "Private quiz — learning answers after each reveal",
      );
      return null;
    })();
  }

  return sharedQuizLoadPromise;
}

function waitForSharedQuizAnswers() {
  if (sharedQuizAnswers?.answers?.length) {
    return Promise.resolve(sharedQuizAnswers);
  }
  return sharedQuizLoadPromise || Promise.resolve(null);
}

function buildJoinerCallbacks(activeSession, autoAnswer, nickname) {
  return {
    onStatus: (message) => {
      if (activeSession !== session) {
        return;
      }
      appendActivityLog(message, { source: nickname });
      if (
        targetCount === 1 ||
        /Smart mode|Looking up|known answer|quiz answers|google|Googled|learn answers|Private quiz|Answering|Vision|vision|guess/i.test(
          message,
        )
      ) {
        setImportantStatus(message);
      }
    },
    onActivity: ({ steps }) => {
      if (activeSession !== session) {
        return;
      }
      appendActivitySteps(steps, { source: nickname });
    },
    onGameEnd: (result) => {
      if (activeSession !== session) {
        return;
      }
      const existingIndex = gameEndResults.findIndex((entry) => entry.nickname === result.nickname);
      if (existingIndex >= 0) {
        const existing = gameEndResults[existingIndex];
        if (!existing.won && result.won) {
          gameEndResults[existingIndex] = result;
          updateQuizEndSummary(activeSession);
        }
        return;
      }
      gameEndResults.push(result);
      updateQuizEndSummary(activeSession);
    },
    onQuizStart: ({ title, quizId, choiceCounts, pin: quizPin }) => {
      if (activeSession !== session || !autoAnswer) {
        return;
      }
      if (quizId || !sharedQuizAnswers?.answers?.length) {
        sharedQuizLoadPromise = null;
      }
      ensureQuizAnswers(quizPin, title, choiceCounts, quizId, activeSession);
    },
    onLearnedAnswer: ({ pin: learnedPin, quizQuestionIndex, correctChoices }) => {
      if (activeSession !== session) {
        return;
      }
      rememberCorrectChoices(learnedPin, quizQuestionIndex, correctChoices);
      for (const joiner of joiners) {
        joiner.applyQuizAnswers(joiner.quizAnswers);
      }
    },
  };
}

function attemptJoin(activeSession, pin, nickname, autoAnswer, quizAnswers) {
  return new Promise((resolve) => {
    const joiner = new KahootJoiner();
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
      pin,
      nickname,
      autoAnswer,
      quizAnswers: sharedQuizAnswers || quizAnswers,
      waitForQuizAnswers: waitForSharedQuizAnswers,
      getSharedQuizAnswers: () => sharedQuizAnswers,
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
        appendActivityLog(message, { source: nickname, level: "error" });
        settle({ success: false, message });
      },
      ...buildJoinerCallbacks(activeSession, autoAnswer, nickname),
    });

    joinTimeout = setTimeout(() => {
      if (joiner.joined) {
        settle({ success: true });
        return;
      }
      if (activeSession !== session) {
        settle({ success: false, aborted: true });
        return;
      }
      joiner.stop();
      settle({
        success: false,
        message: "Join timed out — Kahoot may be busy. Retrying…",
      });
    }, JOIN_TIMEOUT_MS);
  });
}

async function joinPlayerWithRetry(activeSession, pin, nickname, autoAnswer, quizAnswers) {
  for (let attempt = 1; attempt <= JOIN_RETRY_ATTEMPTS; attempt += 1) {
    if (activeSession !== session) {
      return null;
    }

    const result = await attemptJoin(activeSession, pin, nickname, autoAnswer, quizAnswers);
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
      lastError = "Join timed out — is the PIN correct and the host running?";
      failedCount += 1;
      updateBatchStatus();
      return null;
    }
  }

  return null;
}

async function startPlayers(activeSession, pin, nicknames, autoAnswer) {
  let quizAnswers = getCachedQuizAnswers(pin);

  if (autoAnswer) {
    if (!quizAnswers?.answers?.length) {
      quizAnswers = await prefetchQuizAnswers(pin, { force: true });
    }
    if (activeSession !== session) {
      return;
    }
    if (quizAnswers?.answers?.length) {
      const message = `Loaded ${quizAnswers.answers.length} answers — joining ${nicknames.length} players…`;
      setStatus(message);
      appendActivityLog(message, { source: "system" });
    } else {
      const message = `Joining ${nicknames.length} players — answers load when the host starts the quiz…`;
      setStatus(message);
      appendActivityLog(message, { source: "system", level: "warn" });
    }
  }

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

        joinPlayerWithRetry(activeSession, pin, nickname, autoAnswer, quizAnswers)
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
  if (connected || anyRunning()) {
    return;
  }

  const pin = normalizePin(pinInput.value);
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
  resetSharedQuizAnswers();
  clearLearnedAnswers(pin);
  stopPrefetchRetryLoop();
  clearActivityLog();

  const nicknames = buildNicknames(count, baseName || "bot.locker-rover.dev", useRandomNames);
  appendActivityLog(`Starting batch: ${count} player${count === 1 ? "" : "s"}, PIN ${formatPinForDisplay(pin)}`, {
    source: "system",
  });
  if (autoAnswer) {
    appendActivityLog("Stormy™ AI on — web search + vision for image questions", {
      source: "system",
    });
  }

  setConnected(true);
  setStatus(`Joining ${count} player${count === 1 ? "" : "s"}...`);
  startPlayers(activeSession, pin, nicknames, autoAnswer);
}

function onDisconnect() {
  session += 1;
  setConnected(false);
  setStatus("Disconnecting...");
  resetSharedQuizAnswers();

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
  if (!nameInput || !randomNamesCheck) {
    return;
  }
  nameInput.disabled = randomNamesCheck.checked || connected;
  if (randomNamesCheck.checked) {
    nameInput.placeholder = generateRandomName();
  } else {
    nameInput.placeholder = "bot.locker-rover.dev";
  }
}

function onPinInput() {
  if (connected) {
    return;
  }
  const formatted = formatPinForDisplay(pinInput.value);
  if (formatted !== pinInput.value) {
    pinInput.value = formatted;
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

countSlider?.addEventListener("input", () => {
  setPlayerCount(countSlider.value);
});

countInput?.addEventListener("input", () => {
  const raw = countInput.value.trim();
  if (!raw) {
    return;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return;
  }
  const count = clampPlayerCount(parsed);
  countSlider.value = String(count);
  if (parsed !== count) {
    countInput.value = String(count);
  }
});

countInput?.addEventListener("change", () => {
  setPlayerCount(countInput.value);
});

countInput?.addEventListener("blur", () => {
  setPlayerCount(countInput.value);
});
randomNamesCheck?.addEventListener("change", onRandomNamesToggle);
autoAnswerCheck?.addEventListener("change", onAutoAnswerToggle);
pinInput?.addEventListener("input", onPinInput);
pinInput?.addEventListener("blur", onPinInput);
joinButton?.addEventListener("click", onJoin);
disconnectButton?.addEventListener("click", onDisconnect);
const clearLogButton = document.getElementById("clear-log");
if (clearLogButton) {
  clearLogButton.addEventListener("click", () => clearActivityLog());
}

const viewDecoy = document.getElementById("view-decoy");
const viewJoiner = document.getElementById("view-joiner");
const decoyForm = document.getElementById("decoy-form");
const decoyPinInput = document.getElementById("decoy-pin");
const decoyStatusEl = document.getElementById("decoy-status");
const decoyEnterButton = document.getElementById("decoy-enter");

const VIEW = {
  KAHOOT_DECOY: "kahoot-decoy",
  KAHOOT_JOINER: "kahoot-joiner",
};

let showingJoiner = false;
let activeView = VIEW.KAHOOT_DECOY;
let quickExitBuffer = "";
let quickExitTimer = null;
const QUICK_EXIT_SEQUENCE = "qw";
const QUICK_EXIT_TIMEOUT_MS = 1200;

function isTypingInField() {
  const element = document.activeElement;
  if (!element) {
    return false;
  }
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable;
}

function resetQuickExitBuffer() {
  quickExitBuffer = "";
  if (quickExitTimer) {
    clearTimeout(quickExitTimer);
    quickExitTimer = null;
  }
}

function setActiveView(viewName) {
  activeView = viewName;
  showingJoiner = viewName === VIEW.KAHOOT_JOINER;

  const views = {
    [VIEW.KAHOOT_DECOY]: viewDecoy,
    [VIEW.KAHOOT_JOINER]: viewJoiner,
  };

  for (const [name, element] of Object.entries(views)) {
    if (!element) {
      continue;
    }
    const show = name === viewName;
    element.classList.toggle("is-hidden", !show);
    element.hidden = !show;
  }

  const titles = {
    [VIEW.KAHOOT_DECOY]: "Enter Game PIN - Kahoot!",
    [VIEW.KAHOOT_JOINER]: "Test Joiner",
  };
  document.title = titles[viewName] || titles[VIEW.KAHOOT_DECOY];

  const backgrounds = {
    [VIEW.KAHOOT_DECOY]: "#2f1d5c",
    [VIEW.KAHOOT_JOINER]: "#1a1033",
  };
  document.documentElement.style.background = backgrounds[viewName] || "#2f1d5c";
  resetQuickExitBuffer();
}

function setView(showJoiner) {
  setActiveView(showJoiner ? VIEW.KAHOOT_JOINER : VIEW.KAHOOT_DECOY);
}

function handleQuickExitKey(event) {
  if (isTypingInField()) {
    resetQuickExitBuffer();
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) {
    return;
  }

  quickExitBuffer += event.key.toLowerCase();
  if (quickExitTimer) {
    clearTimeout(quickExitTimer);
  }
  quickExitTimer = window.setTimeout(() => {
    resetQuickExitBuffer();
  }, QUICK_EXIT_TIMEOUT_MS);

  if (!QUICK_EXIT_SEQUENCE.startsWith(quickExitBuffer)) {
    quickExitBuffer = event.key.toLowerCase();
    if (!QUICK_EXIT_SEQUENCE.startsWith(quickExitBuffer)) {
      resetQuickExitBuffer();
    }
    return;
  }

  if (quickExitBuffer === QUICK_EXIT_SEQUENCE) {
    resetQuickExitBuffer();
    if (activeView === VIEW.KAHOOT_DECOY) {
      setActiveView(VIEW.KAHOOT_JOINER);
      return;
    }
    if (activeView === VIEW.KAHOOT_JOINER) {
      setActiveView(VIEW.KAHOOT_DECOY);
    }
  }
}

function formatDecoyPin(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 7);
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

function onDecoyPinInput() {
  if (!decoyPinInput) {
    return;
  }
  const formatted = formatDecoyPin(decoyPinInput.value);
  if (formatted !== decoyPinInput.value) {
    decoyPinInput.value = formatted;
  }
  if (decoyStatusEl) {
    decoyStatusEl.textContent = "";
  }
}

async function validateGamePin(pin) {
  const response = await fetch(`/api/session?pin=${encodeURIComponent(pin)}`);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Could not reach Kahoot. Try again.");
  }

  if (!response.ok || data.error) {
    throw new Error(data.error || "That game doesn't seem to exist. Check the PIN and try again.");
  }

  return true;
}

function getRealKahootJoinUrl(pin) {
  return `https://kahoot.it/?pin=${encodeURIComponent(normalizePin(pin))}`;
}

function redirectToRealKahoot(pin) {
  window.location.assign(getRealKahootJoinUrl(pin));
}

async function onDecoySubmit(event) {
  event.preventDefault();
  if (!decoyPinInput || !decoyEnterButton) {
    return;
  }

  const pin = normalizePin(decoyPinInput.value);

  if (!isValidPin(pin)) {
    if (decoyStatusEl) {
      decoyStatusEl.textContent = "Please enter a valid PIN.";
    }
    return;
  }

  if (decoyStatusEl) {
    decoyStatusEl.textContent = "";
  }
  decoyEnterButton.classList.add("is-loading");
  decoyEnterButton.disabled = true;

  try {
    await validateGamePin(pin);
    redirectToRealKahoot(pin);
  } catch (error) {
    if (decoyStatusEl) {
      decoyStatusEl.textContent = error.message || "That game doesn't seem to exist. Check the PIN and try again.";
    }
    decoyEnterButton.classList.remove("is-loading");
    decoyEnterButton.disabled = false;
  }
}

function openJoinerView() {
  setActiveView(VIEW.KAHOOT_JOINER);
}

function initShell() {
  setActiveView(VIEW.KAHOOT_DECOY);
  document.addEventListener("keydown", handleQuickExitKey);

  const makeNavButton = document.getElementById("open-joiner");
  if (makeNavButton) {
    makeNavButton.addEventListener("click", (event) => {
      event.preventDefault();
      openJoinerView();
    });
  }

  if (decoyForm) {
    decoyForm.addEventListener("submit", onDecoySubmit);
  }
  if (decoyPinInput) {
    decoyPinInput.addEventListener("input", onDecoyPinInput);
    decoyPinInput.addEventListener("blur", onDecoyPinInput);
  }
}

function boot() {
  try {
    initShell();
    if (countSlider && countInput) {
      setPlayerCount(1);
    }
    onRandomNamesToggle();
    startPrefetchRetryLoop();
    schedulePrefetch(pinInput?.value || "");
    checkForUpdates({ initial: true });
    setInterval(() => {
      checkForUpdates();
    }, 30000);
  } catch (error) {
    console.error("App failed to start:", error);
  }
}

boot();
