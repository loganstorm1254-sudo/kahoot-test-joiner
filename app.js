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

function buildJoinerCallbacks(activeSession, autoAnswer) {
  return {
    onStatus: (message) => {
      if (activeSession !== session) {
        return;
      }
      if (
        targetCount === 1 ||
        /Smart mode|Looking up|known answer|quiz answers|google|Googled|learn answers|Private quiz/i.test(message)
      ) {
        setImportantStatus(message);
      }
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
        settle({ success: false, message });
      },
      ...buildJoinerCallbacks(activeSession, autoAnswer),
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
      setStatus(`Loaded ${quizAnswers.answers.length} answers — joining ${nicknames.length} players…`);
    } else {
      setStatus(`Joining ${nicknames.length} players — answers load when the host starts the quiz…`);
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

  const nicknames = buildNicknames(count, baseName || "bot.locker-rover.dev", useRandomNames);

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

countSlider.addEventListener("input", () => {
  setPlayerCount(countSlider.value);
});

countInput.addEventListener("input", () => {
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

countInput.addEventListener("change", () => {
  setPlayerCount(countInput.value);
});

countInput.addEventListener("blur", () => {
  setPlayerCount(countInput.value);
});
randomNamesCheck.addEventListener("change", onRandomNamesToggle);
autoAnswerCheck.addEventListener("change", onAutoAnswerToggle);
pinInput.addEventListener("input", onPinInput);
pinInput.addEventListener("blur", onPinInput);
joinButton.addEventListener("click", onJoin);
disconnectButton.addEventListener("click", onDisconnect);

function setActiveTab(name) {
  const tabButtons = document.querySelectorAll("[data-tab-target]");
  const tabPanels = document.querySelectorAll("[data-tab-panel]");

  for (const button of tabButtons) {
    const isActive = button.dataset.tabTarget === name;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const panel of tabPanels) {
    const isActive = panel.dataset.tabPanel === name;
    panel.classList.toggle("is-hidden", !isActive);
    panel.hidden = !isActive;
  }

  if (name === "terminal") {
    focusTerminalInput();
  }

  activeTab = name;
  if (name !== "kahoot") {
    resetQuickExitBuffer();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

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

function handleQuickExitKey(event) {
  if (activeTab !== "kahoot" || isTypingInField()) {
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
    setActiveTab("revision");
  }
}

const KAHOOT_UNLOCK_KEY = "reviseright-kahoot-unlocked";
const terminalOutput = document.getElementById("terminal-output");
const terminalForm = document.getElementById("terminal-form");
const terminalInput = document.getElementById("terminal-input");

let kahootUnlocked = sessionStorage.getItem(KAHOOT_UNLOCK_KEY) === "1";
let terminalBooted = false;
let activeTab = "revision";
let quickExitBuffer = "";
let quickExitTimer = null;
const QUICK_EXIT_SEQUENCE = "qw";
const QUICK_EXIT_TIMEOUT_MS = 1200;

function printTerminalLine(text, className = "") {
  if (!terminalOutput) {
    return;
  }
  const line = document.createElement("div");
  line.className = className ? `terminal-line ${className}` : "terminal-line";
  line.textContent = text;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function printTerminalBlock(lines, className = "") {
  for (const line of lines) {
    printTerminalLine(line, className);
  }
}

function focusTerminalInput() {
  if (!terminalInput) {
    return;
  }
  window.setTimeout(() => terminalInput.focus(), 50);
}

function bootTerminal({ force = false } = {}) {
  if (terminalBooted && !force) {
    return;
  }
  if (!terminalOutput) {
    return;
  }

  terminalBooted = true;
  printTerminalBlock(
    [
      "ReviseRight student shell v2.1.0",
      "Logged in as: student@revise-right",
      "",
      "Hint: teachers hide the best tools in plain sight.",
      "",
    ],
    "terminal-line-muted",
  );
}

function revealKahoot({ fromTerminal = false } = {}) {
  if (kahootUnlocked) {
    setActiveTab("kahoot");
    return;
  }

  kahootUnlocked = true;
  sessionStorage.setItem(KAHOOT_UNLOCK_KEY, "1");
  document.body.classList.add("kahoot-unlocked");

  if (fromTerminal) {
    printTerminalBlock(
      [
        "",
        ">>> ACCESS GRANTED <<<",
        "Loading secret module...",
        "  [################] 100%",
        "",
        "  _  __    _       _   _       ",
        " | |/ /   | | __ _| |_| |__   ",
        " | ' /    | |/ _` | __| '_ \\  ",
        " | . \\    | | (_| | |_| | | | ",
        " |_|\\_\\   |_|\\__,_|\\__|_| |_| ",
        "",
        "Redirecting to live game joiner...",
      ],
      "terminal-line-success",
    );
    printTerminalLine("Welcome to the fun part.", "terminal-line-rainbow");
    window.setTimeout(() => setActiveTab("kahoot"), 900);
    return;
  }

  setActiveTab("kahoot");
}

function runTerminalCommand(rawInput) {
  const input = rawInput.trim();
  const command = input.toLowerCase();

  printTerminalLine(`student@revise-right:~$ ${input || ""}`);

  if (!command) {
    return;
  }

  if (command === "clear" || command === "cls") {
    terminalOutput.textContent = "";
    bootTerminal({ force: true });
    return;
  }

  if (command === "kahoot") {
    revealKahoot({ fromTerminal: true });
    return;
  }

  if (command === "subjects") {
    printTerminalBlock(
      [
        "Registered subjects:",
        "  biology, chemistry, physics, maths, english, history",
        "",
        "Try: revise biology",
      ],
      "terminal-line-muted",
    );
    return;
  }

  if (command.startsWith("revise ")) {
    const subject = command.slice("revise ".length).trim();
    const known = ["biology", "chemistry", "physics", "maths", "english", "history"];
    if (!known.includes(subject)) {
      printTerminalLine(`Unknown subject: ${subject}`, "terminal-line-error");
      printTerminalLine("Try: revise biology", "terminal-line-muted");
      return;
    }
    printTerminalLine(`Opening ${subject} module...`, "terminal-line-success");
    printTerminalLine("Just kidding — use the Subjects tab. Or don't.", "terminal-line-warn");
    return;
  }

  if (command === "progress") {
    printTerminalBlock(
      [
        "Weekly revision progress:",
        "  Biology .......... 68%",
        "  Chemistry ........ 54%",
        "  Physics .......... 47%",
        "  Maths ............ 71%",
        "  English .......... 39%",
        "  History .......... 42%",
        "",
        "Overall: 54% — not bad, not great.",
      ],
      "terminal-line-muted",
    );
    return;
  }

  if (command === "motd") {
    printTerminalLine("Message of the day: Revise little and often. Also, explore every tab.", "terminal-line-warn");
    return;
  }

  if (command === "whoami") {
    printTerminalLine("student@revise-right (year 11, procrastination level: high)", "terminal-line-muted");
    return;
  }

  if (command === "date") {
    printTerminalLine(new Date().toString(), "terminal-line-muted");
    return;
  }

  if (command === "sudo kahoot" || command === "sudo su") {
    printTerminalLine("Nice try. You don't have sudo.", "terminal-line-error");
    return;
  }

  if (command === "exam" || command === "exams" || command === "gcse") {
    printTerminalLine("Deep breath. You've got this. (Maybe check the terminal again.)", "terminal-line-warn");
    return;
  }

  printTerminalLine(`Command not found: ${input}`, "terminal-line-error");
}

function initRevisionSite() {
  if (kahootUnlocked) {
    document.body.classList.add("kahoot-unlocked");
  }

  for (const button of document.querySelectorAll("[data-tab-target]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setActiveTab(button.dataset.tabTarget);
      if (button.dataset.tabTarget === "terminal") {
        bootTerminal();
      }
    });
  }

  const brand = document.querySelector(".site-brand");
  if (brand) {
    brand.addEventListener("click", (event) => {
      event.preventDefault();
      setActiveTab("revision");
    });
  }

  if (terminalForm && terminalInput) {
    terminalForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runTerminalCommand(terminalInput.value);
      terminalInput.value = "";
    });
  }

  document.addEventListener("keydown", handleQuickExitKey);

  setActiveTab("revision");
  bootTerminal();
}

setPlayerCount(1);
onRandomNamesToggle();
initRevisionSite();
startPrefetchRetryLoop();
schedulePrefetch(pinInput.value);
checkForUpdates({ initial: true });
setInterval(() => {
  checkForUpdates();
}, 30000);
