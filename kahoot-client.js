import {
  getLearnedCorrectIndices,
  isTrustedQuizAnswers,
  lookupSearchAnswer,
  normalizePin,
  prefetchSearchAnswer,
  rememberCorrectChoices,
  resolveChoice,
} from "./quiz-answers.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SERVICE_CHANNELS = ["/service/controller", "/service/player", "/service/status"];

const CHALLENGE_RE =
  /decode\.call\(this,\s*'([a-zA-Z0-9]*)'\);\s*function decode\(message\)\s*\{var offset = ([0-9+\-*/()\s]+);/;

function safeEvalMath(expr) {
  const cleaned = expr.trim();
  if (!/^[\d+\-*/()\s]+$/.test(cleaned)) {
    throw new Error("Invalid challenge offset expression");
  }
  return Function(`"use strict"; return (${cleaned});`)();
}

function decodeChallengeToken(token, offset) {
  let result = "";
  for (let index = 0; index < token.length; index += 1) {
    result += String.fromCharCode((((token.charCodeAt(index) * index) + offset) % 77) + 48);
  }
  return result;
}

function solveChallengeWithEval(challenge) {
  let source = challenge.replace(/(\u0009|\u2003)/g, "");
  source = source.replace(/this /g, "this");
  source = source.replace(/ *\./g, ".");
  source = source.replace(/ *\( */g, "(");
  source = source.replace(/ *\) */g, ")");
  source = source.replace(/console\./g, "");
  source = source.replace("this.angular.isObject(offset)", "true");
  source = source.replace("this.angular.isString(offset)", "true");
  source = source.replace("this.angular.isDate(offset)", "true");
  source = source.replace("this.angular.isArray(offset)", "true");

  const prelude =
    'var _ = { replace: function(str, pattern, replacer) { return String(str).replace(pattern, replacer); } }; var log = function(){}; return ';
  const solver = Function(`${prelude}${source}`);
  return String(solver());
}

function solveChallenge(challenge) {
  const cleaned = challenge.replace(/\t/g, "").replace(/\u2003/g, "");
  let match = cleaned.match(CHALLENGE_RE);

  if (match) {
    return decodeChallengeToken(match[1], safeEvalMath(match[2]));
  }

  try {
    return solveChallengeWithEval(cleaned);
  } catch {
    const loose = cleaned.match(/decode\.call\(this,\s*'([a-zA-Z0-9]*)'\)/);
    const offsetMatch = cleaned.match(/var offset = ([^;]+);/);
    if (!loose || !offsetMatch) {
      throw new Error("Could not parse Kahoot challenge");
    }
    return decodeChallengeToken(loose[1], safeEvalMath(offsetMatch[1]));
  }
}

function decipherToken(sessionTokenB64, challenge) {
  const mask = solveChallenge(challenge);
  const headerBinary = atob(sessionTokenB64);
  let result = "";
  for (let index = 0; index < headerBinary.length; index += 1) {
    result += String.fromCharCode(
      headerBinary.charCodeAt(index) ^ mask.charCodeAt(index % mask.length)
    );
  }
  return result;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
      throw new Error(
        "API not found — /api/session returned HTML instead of JSON. Redeploy with the api/ folder included."
      );
    }
    throw new Error("Invalid response from server");
  }
}

async function reserveSession(pin, { attempts = 3 } = {}) {
  let lastError = new Error("Could not reserve Kahoot session");

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`/api/session?pin=${encodeURIComponent(pin)}`);
      const data = await readJsonResponse(response);

      if (!response.ok || data.error) {
        throw new Error(data.error || `Kahoot returned status ${response.status}`);
      }

      if (!data.sessionToken || !data.challenge) {
        throw new Error("Kahoot did not return session data");
      }

      return { sessionToken: data.sessionToken, challenge: data.challenge };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      }
    }
  }

  throw lastError;
}

function makeWebSocketUrl(pin, cometToken) {
  // Connect directly to Kahoot — browsers allow this. Only /api/session needs a proxy (CORS).
  return `wss://kahoot.it/cometd/${encodeURIComponent(pin)}/${encodeURIComponent(cometToken)}`;
}

function parseData(data) {
  if (!data) {
    return {};
  }
  if (typeof data === "object") {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function shuffle(array) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function playerMessageId(data) {
  const id = Number(data?.id);
  return Number.isFinite(id) ? id : -1;
}

function normalizeQuestionType(type) {
  const value = String(type || "").toLowerCase();
  if (!value || value === "classic" || value === "true_false") {
    return "quiz";
  }
  return value;
}

function isAnswerableBlockType(type) {
  const value = String(type || "").toLowerCase();
  return value && value !== "content";
}

function parseMessageContent(data) {
  const raw = data?.content;
  if (raw == null || raw === "") {
    return {};
  }
  if (typeof raw === "object") {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function extractQuizMetadata(content) {
  return {
    title:
      content.quizName ||
      content.quizTitle ||
      content.name ||
      content.title ||
      content.kahootTitle ||
      "",
    quizId: content.quizId || content.quizUuid || content.uuid || content.kahootId || "",
    choiceCounts: Array.isArray(content.quizQuestionAnswers) ? content.quizQuestionAnswers : [],
  };
}

function extractCorrectChoices(content) {
  if (Array.isArray(content.correctChoices) && content.correctChoices.length) {
    return content.correctChoices;
  }
  if (Array.isArray(content.correctAnswers) && content.correctAnswers.length) {
    return content.correctAnswers;
  }
  if (content.correctAnswer != null) {
    return [Number(content.correctAnswer)];
  }
  if (content.correctIndex != null) {
    return [Number(content.correctIndex)];
  }
  if (content.isCorrect && content.choice != null) {
    return Array.isArray(content.choice) ? content.choice : [content.choice];
  }
  return null;
}

export class KahootJoiner {
  constructor() {
    this.reset();
  }

  reset() {
    this.pin = "";
    this.nickname = "bot.locker-rover.dev";
    this.autoAnswer = false;
    this.onJoined = () => {};
    this.onError = () => {};
    this.onStatus = () => {};
    this.onGameEnd = () => {};
    this.onQuizStart = () => {};
    this.onLearnedAnswer = () => {};

    this.ws = null;
    this.clientId = null;
    this.timesync = null;
    this.messageId = 0;
    this.handshakeComplete = false;
    this.loginSent = false;
    this.subscribed = false;
    this.joined = false;
    this.readyToPlay = false;
    this.currentQuestionIndex = 0;
    this.currentQuestionType = "quiz";
    this.currentNumChoices = 4;
    this.lastAnsweredIndex = -1;
    this.closed = false;
    this.runId = 0;
    this.cid = null;
    this.answerTimer = null;
    this.questionStartTime = 0;
    this.questionActive = false;
    this.twoFactorPending = false;
    this.usesGameBlocks = false;
    this.quizAnswers = null;
    this.blockToQuizIndex = new Map();
    this.nextQuizQuestionIndex = 0;
    this.activeQuizQuestionIndex = -1;
    this.podiumMedalType = null;
    this.gameEndReported = false;
    this.pendingGameEnd = null;
    this.gameEndTimer = null;
    this.pendingRanking = null;
    this.liveQuizTitle = "";
    this.liveQuizId = "";
    this.liveChoiceCounts = [];
    this.quizLookupStarted = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.answerWatchdog = null;
    this.sessionJoined = false;
    this.answeringBlockIndex = -1;
  }

  applyQuizAnswers(quizAnswers) {
    const hasBlockAnswers = Array.isArray(quizAnswers?.answersByBlockIndex)
      ? quizAnswers.answersByBlockIndex.some((entry) => entry?.correctIndices?.length)
      : false;
    if (quizAnswers?.answers?.length || hasBlockAnswers) {
      this.quizAnswers = quizAnswers;
    }
  }

  status(message) {
    this.onStatus(message);
  }

  start({
    pin,
    nickname,
    autoAnswer,
    onJoined,
    onError,
    onStatus,
    onGameEnd,
    onQuizStart,
    onLearnedAnswer,
    quizAnswers,
    waitForQuizAnswers,
    getSharedQuizAnswers,
  }) {
    this.stop(false);
    this.reset();

    this.pin = normalizePin(pin);
    this.nickname = nickname.trim() || "bot.locker-rover.dev";
    this.autoAnswer = Boolean(autoAnswer);
    this.quizAnswers = quizAnswers || null;
    this.onJoined = onJoined || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onGameEnd = onGameEnd || (() => {});
    this.onQuizStart = onQuizStart || (() => {});
    this.onLearnedAnswer = onLearnedAnswer || (() => {});
    this.waitForQuizAnswers = waitForQuizAnswers || (() => Promise.resolve(null));
    this.getSharedQuizAnswers = getSharedQuizAnswers || (() => null);

    this.runId += 1;
    const runId = this.runId;
    this.closed = false;

    this.connect(runId).catch((error) => {
      if (runId !== this.runId || this.closed) {
        return;
      }
      this.onError(error.message || String(error));
      this.stop(false);
    });
  }

  stop() {
    if (this.answerTimer) {
      clearTimeout(this.answerTimer);
      this.answerTimer = null;
    }
    if (this.answerWatchdog) {
      clearTimeout(this.answerWatchdog);
      this.answerWatchdog = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.gameEndTimer) {
      clearTimeout(this.gameEndTimer);
      this.gameEndTimer = null;
    }

    const ws = this.ws;
    const clientId = this.clientId;

    if (ws && clientId && ws.readyState === WebSocket.OPEN) {
      try {
        this.sendRaw({
          channel: "/meta/disconnect",
          clientId,
          ext: { timesync: Date.now() },
          id: this.nextId(),
        });
      } catch {
        // ignore
      }
    }

    this.closed = true;
    this.joined = false;
    this.readyToPlay = false;
    this.runId += 1;

    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }

    this.ws = null;
  }

  isRunning() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN && !this.closed);
  }

  async connect(runId) {
    const { sessionToken, challenge } = await reserveSession(this.pin);
    if (runId !== this.runId || this.closed) {
      return;
    }

    const cometToken = decipherToken(sessionToken, challenge);
    if (runId !== this.runId || this.closed) {
      return;
    }

    const wsUrl = makeWebSocketUrl(this.pin, cometToken);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    await new Promise((resolve, reject) => {
      let settled = false;

      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const timeout = setTimeout(() => finish(new Error("Connection timed out")), 25000);

      ws.onopen = () => {
        if (runId !== this.runId || this.closed) {
          ws.close();
          finish();
          return;
        }
        this.send({
          channel: "/meta/handshake",
          version: "1.0",
          minimumVersion: "1.0",
          supportedConnectionTypes: ["websocket", "long-polling"],
          advice: { interval: 0, timeout: 60000 },
          ext: {
            ack: true,
            timesync: { l: 0, o: 0, tc: Date.now() },
          },
        });
        finish();
      };

      ws.onerror = () => finish(new Error("WebSocket connection failed"));
      ws.onclose = (event) => {
        if (!settled) {
          finish(new Error(event.reason || "WebSocket closed before connecting"));
        }
      };
    });

    ws.onmessage = (event) => this.onMessage(event.data, runId);
    ws.onerror = () => {
      if (!this.closed && runId === this.runId) {
        this.onError("Connection error");
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      if (this.closed || runId !== this.runId || this.gameEndReported) {
        if (!this.sessionJoined) {
          this.joined = false;
        }
        this.readyToPlay = false;
        return;
      }
      this.readyToPlay = false;
      this.status("Connection lost — reconnecting…");
      this.scheduleReconnect(runId);
    };
  }

  scheduleReconnect(runId) {
    if (this.closed || this.gameEndReported || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 6) {
      this.onError("Connection lost — could not reconnect");
      return;
    }

    const delay = Math.min(800 * this.reconnectAttempts, 5000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed || runId !== this.runId || this.gameEndReported) {
        return;
      }

      this.handshakeComplete = false;
      this.loginSent = false;
      this.subscribed = false;
      this.clientId = null;

      this.connect(runId).catch((error) => {
        if (runId !== this.runId || this.closed || this.gameEndReported) {
          return;
        }
        this.scheduleReconnect(runId);
      });
    }, delay);
  }

  clearAnswerTimers() {
    if (this.answerTimer) {
      clearTimeout(this.answerTimer);
      this.answerTimer = null;
    }
    if (this.answerWatchdog) {
      clearTimeout(this.answerWatchdog);
      this.answerWatchdog = null;
    }
  }

  submitAutoAnswer(runId, questionIndex, questionType, numChoices) {
    if (this.closed || runId !== this.runId) {
      return false;
    }
    if (this.lastAnsweredIndex === questionIndex || this.answeringBlockIndex === questionIndex) {
      return false;
    }
    if (this.currentQuestionIndex !== questionIndex) {
      return false;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.answeringBlockIndex = questionIndex;
    this.buildAndSendAnswer(runId, questionIndex, questionType, numChoices)
      .catch(() => {})
      .finally(() => {
        if (this.answeringBlockIndex === questionIndex) {
          this.answeringBlockIndex = -1;
        }
      });
    return true;
  }

  getQuestionEntry() {
    const blockIndex = this.currentQuestionIndex;
    const quizIndex =
      this.activeQuizQuestionIndex >= 0
        ? this.activeQuizQuestionIndex
        : this.currentQuestionIndex;

    return (
      this.quizAnswers?.answersByBlockIndex?.[blockIndex] ||
      this.quizAnswers?.answers?.[quizIndex] ||
      null
    );
  }

  hasTrustedPrefetchAnswer() {
    if (!this.hasKnownAnswer()) {
      return false;
    }
    return isTrustedQuizAnswers(this.quizAnswers, {
      liveQuizId: this.liveQuizId,
      liveQuizTitle: this.liveQuizTitle,
    });
  }

  canUseWebSearch() {
    const entry = this.getQuestionEntry();
    return Boolean(entry?.question && entry?.choiceLabels?.length >= 2);
  }

  getSearchOptions() {
    const entry = this.getQuestionEntry();
    const imageUrl = entry?.imageUrl || entry?.choiceImages?.[0] || "";
    return {
      imageUrl,
      timeoutMs: imageUrl ? 14000 : 10000,
    };
  }

  hasLearnedAnswer() {
    const blockIndex = this.currentQuestionIndex;
    const quizIndex =
      this.activeQuizQuestionIndex >= 0
        ? this.activeQuizQuestionIndex
        : this.currentQuestionIndex;
    return Boolean(
      getLearnedCorrectIndices(this.pin, blockIndex)?.length ||
        getLearnedCorrectIndices(this.pin, quizIndex)?.length,
    );
  }

  prefetchSearchForCurrentQuestion() {
    const entry = this.getQuestionEntry();
    if (!entry?.question || entry.choiceLabels.length < 2 || this.hasLearnedAnswer()) {
      return;
    }
    if (this.hasTrustedPrefetchAnswer()) {
      return;
    }
    prefetchSearchAnswer(entry.question, entry.choiceLabels, this.getSearchOptions());
  }

  formatSearchDetail(searchResult) {
    const query = searchResult?.queries?.[0];
    const snippets = searchResult?.snippetCount || 0;
    const imageNote = searchResult?.usedImage ? " + image" : "";
    if (!query) {
      return imageNote ? `Googled image (${snippets} snippets)` : "";
    }
    const shortQuery = query.length > 72 ? `${query.slice(0, 69)}...` : query;
    return `Googled "${shortQuery}"${imageNote} (${snippets} snippets)`;
  }

  async buildAndSendAnswer(runId, questionIndex, questionType, numChoices) {
    const shared = this.getSharedQuizAnswers?.();
    if (shared) {
      this.applyQuizAnswers(shared);
    }

    const entry = this.getQuestionEntry();
    if (entry?.question && !this.hasLearnedAnswer() && this.canUseWebSearch()) {
      const preview =
        entry.question.length > 72 ? `${entry.question.slice(0, 69)}...` : entry.question;
      const imageUrl = entry.imageUrl || entry.choiceImages?.[0];
      this.status(imageUrl ? `Googling image + text: "${preview}"` : `Googling: "${preview}"`);
    }

    const { choice, mode, detail } = await this.buildSmartChoice(questionType, numChoices);

    if (
      this.closed ||
      runId !== this.runId ||
      this.currentQuestionIndex !== questionIndex ||
      this.lastAnsweredIndex === questionIndex
    ) {
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.lastAnsweredIndex = questionIndex;
    const suffix = detail ? ` — ${detail}` : "";
    this.status(
      `Answering block ${questionIndex} → ${typeof choice === "number" ? `choice ${choice + 1}` : choice} (${mode}${suffix})`,
    );
    this.sendAnswerModern(choice);
    if (!this.usesGameBlocks) {
      setTimeout(() => {
        if (!this.closed && runId === this.runId) {
          this.sendAnswerLegacy(typeof choice === "number" ? choice : 0);
        }
      }, 50);
    }
  }

  async buildSmartChoice(type, numChoices) {
    const quizIndex =
      this.activeQuizQuestionIndex >= 0
        ? this.activeQuizQuestionIndex
        : this.currentQuestionIndex;
    const blockIndex = this.currentQuestionIndex;
    const entry = this.getQuestionEntry();

    if (this.hasLearnedAnswer()) {
      return {
        choice: resolveChoice(
          type,
          numChoices,
          quizIndex,
          this.quizAnswers,
          this.pin,
          blockIndex,
        ),
        mode: "learned",
      };
    }

    if (this.hasTrustedPrefetchAnswer()) {
      return {
        choice: resolveChoice(
          type,
          numChoices,
          quizIndex,
          this.quizAnswers,
          this.pin,
          blockIndex,
        ),
        mode: "quiz answers",
      };
    }

    if (type === "open_ended" || type === "word_cloud") {
      if (entry?.question) {
        const search = await lookupSearchAnswer(
          entry.question,
          entry.choiceLabels || [],
          this.getSearchOptions(),
        );
        if (search?.textAnswer) {
          return {
            choice: search.textAnswer,
            mode: "google",
            detail: this.formatSearchDetail(search),
          };
        }
      }

      const textAnswers = this.quizAnswers?.answers?.[quizIndex]?.textAnswers;
      if (Array.isArray(textAnswers) && textAnswers.length > 0) {
        return { choice: textAnswers[Math.floor(Math.random() * textAnswers.length)], mode: "known answer" };
      }

      return {
        choice: ["idk", "hello", "yes", "ok", "maybe", "hmm", "lol", "hi"][
          Math.floor(Math.random() * 8)
        ],
        mode: "guess",
      };
    }

    if (entry?.question && entry?.choiceLabels?.length >= 2) {
      const search = await lookupSearchAnswer(
        entry.question,
        entry.choiceLabels,
        this.getSearchOptions(),
      );
      if (search?.choiceIndex != null && search.choiceIndex >= 0 && search.choiceIndex < numChoices) {
        return {
          choice: search.choiceIndex,
          mode: "google",
          detail: this.formatSearchDetail(search),
        };
      }
    }

    return {
      choice: resolveChoice(type, numChoices, quizIndex, this.quizAnswers, this.pin, blockIndex),
      mode: "guess",
    };
  }

  nextId() {
    this.messageId += 1;
    return String(this.messageId);
  }

  sendRaw(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify([message]));
  }

  send(message) {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const channel = message.channel || "";
    if (channel !== "/meta/handshake" && this.clientId) {
      message.clientId = this.clientId;
    }
    message.id = this.nextId();
    this.sendRaw(message);
  }

  subscribeChannels() {
    if (this.subscribed || this.closed) {
      return;
    }
    this.subscribed = true;
    for (const subscription of SERVICE_CHANNELS) {
      this.send({
        channel: "/meta/subscribe",
        subscription,
      });
    }
  }

  sendFirstConnect() {
    if (!this.timesync) {
      return;
    }
    this.send({
      channel: "/meta/connect",
      connectionType: "websocket",
      advice: { timeout: 0 },
      ext: {
        ack: 0,
        timesync: {
          l: this.timesync.l,
          o: this.timesync.o,
          tc: Date.now(),
        },
      },
    });
  }

  sendConnectPong(message) {
    if (this.closed || !this.timesync) {
      return;
    }
    const ext = message.ext || {};
    this.send({
      channel: "/meta/connect",
      connectionType: "websocket",
      ext: {
        ack: ext.ack ?? 0,
        timesync: {
          l: this.timesync.l,
          o: this.timesync.o,
          tc: Date.now(),
        },
      },
    });
  }

  login() {
    if (this.loginSent || this.closed) {
      return;
    }
    this.loginSent = true;
    this.send({
      channel: "/service/controller",
      data: {
        type: "login",
        gameid: this.pin,
        host: "kahoot.it",
        name: this.nickname,
        content: JSON.stringify({
          device: {
            userAgent: USER_AGENT,
            screen: { width: 1920, height: 1080 },
          },
        }),
      },
    });
  }

  sendNamerator() {
    const payload = {
      channel: "/service/controller",
      data: {
        id: 16,
        type: "message",
        gameid: this.pin,
        host: "kahoot.it",
        content: JSON.stringify({ usingNamerator: false }),
      },
    };
    this.send(payload);
    setTimeout(() => this.send(payload), 50);
  }

  sendControllerMessage(messageId, content) {
    this.send({
      channel: "/service/controller",
      data: {
        id: messageId,
        type: "message",
        gameid: this.pin,
        host: "kahoot.it",
        content,
      },
    });
  }

  sendTwoFactorAuth() {
    const sequence = shuffle([0, 1, 2, 3]).join("");
    this.sendControllerMessage(50, JSON.stringify({ sequence }));
  }

  hasKnownAnswer() {
    const blockIndex = this.currentQuestionIndex;
    const quizIndex =
      this.activeQuizQuestionIndex >= 0
        ? this.activeQuizQuestionIndex
        : this.currentQuestionIndex;
    const blockAnswer = this.quizAnswers?.answersByBlockIndex?.[blockIndex];
    const compactAnswer = this.quizAnswers?.answers?.[quizIndex];
    return Boolean(
      blockAnswer?.correctIndices?.length ||
        compactAnswer?.correctIndices?.length ||
        getLearnedCorrectIndices(this.pin, blockIndex)?.length ||
        getLearnedCorrectIndices(this.pin, quizIndex)?.length,
    );
  }

  parseChoiceCount(content, questionType, questionIndex) {
    if (questionType === "jumble") {
      return 4;
    }
    if (content.numberOfChoices != null) {
      return Math.min(Math.max(content.numberOfChoices, 1), 6);
    }
    if (content.quizQuestionAnswers && content.quizQuestionAnswers.length > 0) {
      const arrayIndex = this.usesGameBlocks
        ? Math.max(0, questionIndex)
        : Math.max(0, (questionIndex || 1) - 1);
      const count = content.quizQuestionAnswers[arrayIndex];
      if (count == null || count === 0) {
        return null;
      }
      return Math.min(Math.max(count, 1), 6);
    }
    if (content.answerMap) {
      return Math.min(Math.max(Object.keys(content.answerMap).length, 1), 6);
    }
    if (content.numberOfAnswers) {
      return Math.min(Math.max(content.numberOfAnswers, 1), 6);
    }
    return 4;
  }

  updateQuestionState(content, messageId) {
    if (content.gameBlockIndex != null) {
      this.usesGameBlocks = true;
      this.currentQuestionIndex = content.gameBlockIndex;
    } else if (content.questionIndex != null) {
      this.currentQuestionIndex = content.questionIndex;
    } else if (content.questionNumber != null) {
      this.currentQuestionIndex = content.questionNumber;
    }

    const blockType = content.type || content.gameBlockType || content.quizType || "";
    if (blockType) {
      this.currentQuestionType = normalizeQuestionType(blockType);
    }

    if (messageId === 1 && isAnswerableBlockType(blockType || this.currentQuestionType)) {
      if (!this.blockToQuizIndex.has(this.currentQuestionIndex)) {
        this.blockToQuizIndex.set(this.currentQuestionIndex, this.nextQuizQuestionIndex);
        this.nextQuizQuestionIndex += 1;
      }
      this.activeQuizQuestionIndex = this.blockToQuizIndex.get(this.currentQuestionIndex);
    }

    if (messageId === 2 || messageId === 43) {
      if (this.blockToQuizIndex.has(this.currentQuestionIndex)) {
        this.activeQuizQuestionIndex = this.blockToQuizIndex.get(this.currentQuestionIndex);
      }
    }

    const choiceCount = this.parseChoiceCount(
      content,
      this.currentQuestionType,
      this.currentQuestionIndex,
    );
    if (choiceCount) {
      this.currentNumChoices = choiceCount;
    }

    if (messageId === 1) {
      // GET_READY can arrive after QUESTION_START and used to clear questionActive too early.
      // Reveal (id 8) is the only signal that answering for this block is finished.
    }
  }

  sendAnswerModern(choice) {
    const questionIndex = this.currentQuestionIndex;
    const type = normalizeQuestionType(this.currentQuestionType || "quiz");
    const lag = Math.max(0, Date.now() - (this.questionStartTime || Date.now()));
    const sync = this.timesync || { l: 30, o: 0 };
    let inner;

    if (typeof choice === "string") {
      inner = { text: choice, questionIndex, type, meta: { lag: Math.max(lag, sync.l) } };
    } else if (Array.isArray(choice)) {
      inner = { choice, questionIndex, type, meta: { lag: Math.max(lag, sync.l) } };
    } else {
      inner = { choice, questionIndex, type, meta: { lag: Math.max(lag, sync.l) } };
    }

    this.sendControllerMessage(45, JSON.stringify(inner));
  }

  sendAnswerLegacy(choice) {
    const sync = this.timesync || { l: 30, o: 0 };
    const inner = {
      choice,
      questionIndex: this.currentQuestionIndex,
      meta: {
        lag: sync.l,
        device: {
          userAgent: USER_AGENT,
          screen: { width: 1920, height: 1080 },
        },
      },
    };
    this.sendControllerMessage(6, JSON.stringify(inner));
  }

  scheduleAutoAnswer(runId) {
    if (!this.autoAnswer || this.closed || !this.readyToPlay || this.twoFactorPending) {
      return;
    }
    if (!isAnswerableBlockType(this.currentQuestionType)) {
      return;
    }
    if (this.currentQuestionIndex === this.lastAnsweredIndex) {
      return;
    }

    const questionIndex = this.currentQuestionIndex;
    const questionType = this.currentQuestionType;
    const numChoices = Math.max(this.currentNumChoices || 4, 1);
    const searchOptions = this.getSearchOptions();
    const answerDelay = this.hasLearnedAnswer() || this.hasTrustedPrefetchAnswer()
      ? 30 + Math.floor(Math.random() * 90)
      : this.canUseWebSearch()
        ? searchOptions.imageUrl
          ? 5200 + Math.floor(Math.random() * 1800)
          : 3600 + Math.floor(Math.random() * 1400)
        : 30 + Math.floor(Math.random() * 90);

    this.clearAnswerTimers();

    this.answerTimer = setTimeout(() => {
      this.answerTimer = null;
      if (this.closed || runId !== this.runId) {
        return;
      }
      this.submitAutoAnswer(runId, questionIndex, questionType, numChoices);
    }, answerDelay);

    this.answerWatchdog = setTimeout(() => {
      this.answerWatchdog = null;
      if (this.closed || runId !== this.runId) {
        return;
      }
      if (this.lastAnsweredIndex === questionIndex) {
        return;
      }
      if (this.currentQuestionIndex !== questionIndex) {
        return;
      }
      this.submitAutoAnswer(runId, questionIndex, questionType, numChoices);
    }, searchOptions.imageUrl ? 15000 : 12000);
  }

  reportGameEnd(content) {
    if (this.gameEndReported) {
      return;
    }
    this.gameEndReported = true;
    if (this.gameEndTimer) {
      clearTimeout(this.gameEndTimer);
      this.gameEndTimer = null;
    }

    const rank = Number(content.rank ?? this.pendingRanking);
    const totalScore = Number(content.totalScore ?? content.score ?? 0);
    const won = rank === 1 || this.podiumMedalType === "gold";

    this.onGameEnd({
      nickname: this.nickname,
      rank: Number.isFinite(rank) ? rank : null,
      totalScore: Number.isFinite(totalScore) ? totalScore : 0,
      correctCount: Number(content.correctCount) || 0,
      playerCount: Number(content.playerCount) || 0,
      podiumMedalType: this.podiumMedalType,
      won,
    });
  }

  scheduleGameEndReport(runId) {
    if (this.gameEndTimer) {
      clearTimeout(this.gameEndTimer);
    }
    this.gameEndTimer = setTimeout(() => {
      this.gameEndTimer = null;
      if (!this.closed && runId === this.runId && this.pendingGameEnd) {
        this.reportGameEnd(this.pendingGameEnd);
      }
    }, 1200);
  }

  maybeRequestQuizAnswers(content, runId) {
    if (this.closed || runId !== this.runId || this.quizLookupStarted) {
      return;
    }

    const metadata = extractQuizMetadata({
      ...content,
      quizQuestionAnswers: content.quizQuestionAnswers || this.liveChoiceCounts,
      quizName: content.quizName || this.liveQuizTitle,
      quizId: content.quizId || this.liveQuizId,
    });
    const { title, quizId, choiceCounts: counts } = metadata;

    if (!counts.length) {
      return;
    }

    this.liveChoiceCounts = counts;
    if (title) {
      this.liveQuizTitle = title;
    }
    if (quizId) {
      this.liveQuizId = quizId;
    }

    const shared = this.getSharedQuizAnswers?.();
    if (shared) {
      this.applyQuizAnswers(shared);
      return;
    }

    this.quizLookupStarted = true;
    this.onQuizStart({
      title,
      quizId,
      choiceCounts: counts,
      pin: this.pin,
    });
  }

  handleQuizStart(content, runId) {
    if (this.closed || runId !== this.runId) {
      return;
    }

    const metadata = extractQuizMetadata(content);
    if (metadata.title) {
      this.liveQuizTitle = metadata.title;
    }
    if (metadata.quizId) {
      this.liveQuizId = metadata.quizId;
    }
    if (metadata.choiceCounts.length) {
      this.liveChoiceCounts = metadata.choiceCounts;
    }

    this.maybeRequestQuizAnswers(
      {
        ...content,
        ...metadata,
        quizQuestionAnswers: this.liveChoiceCounts,
      },
      runId,
    );
  }

  handlePlayerMessage(data, runId) {
    const id = playerMessageId(data);
    const content = parseMessageContent(data);

    if (id === 14) {
      if (runId === this.runId && !this.closed) {
        this.joined = true;
        this.readyToPlay = true;
        this.reconnectAttempts = 0;
        if (!this.sessionJoined) {
          this.sessionJoined = true;
          this.status(`Joined as ${this.nickname}`);
          this.onJoined(this.nickname);
        } else {
          this.status(`Reconnected as ${this.nickname}`);
        }
        if (
          this.autoAnswer &&
          this.questionActive &&
          this.lastAnsweredIndex !== this.currentQuestionIndex
        ) {
          this.scheduleAutoAnswer(runId);
        }
      }
      this.maybeRequestQuizAnswers(content, runId);
      return;
    }

    if (id === 9) {
      this.handleQuizStart(content, runId);
      return;
    }

    if (id === 3) {
      if (Object.keys(content).length > 0) {
        this.pendingGameEnd = content;
        this.scheduleGameEndReport(runId);
      }
      return;
    }

    if (id === 13) {
      if (content.podiumMedalType) {
        this.podiumMedalType = content.podiumMedalType;
      }
      if (this.pendingGameEnd) {
        this.reportGameEnd(this.pendingGameEnd);
      } else if (Object.keys(content).length > 0) {
        this.reportGameEnd(content);
      }
      return;
    }

    if (id === 52) {
      this.twoFactorPending = false;
      this.readyToPlay = true;
      if (this.questionActive) {
        this.scheduleAutoAnswer(runId);
      }
      return;
    }

    if (id === 53 && this.autoAnswer) {
      this.twoFactorPending = true;
      this.readyToPlay = false;
      this.sendTwoFactorAuth();
      return;
    }

    if (Object.keys(content).length > 0) {
      this.updateQuestionState(content, id);
    }

    if (id === 8) {
      this.questionActive = false;
      this.lastAnsweredIndex = -1;
      this.answeringBlockIndex = -1;
      this.clearAnswerTimers();
      const correctChoices = extractCorrectChoices(content);
      if (Array.isArray(correctChoices) && correctChoices.length) {
        const learnedIndex = this.currentQuestionIndex;
        rememberCorrectChoices(this.pin, learnedIndex, correctChoices);
        this.onLearnedAnswer({
          pin: this.pin,
          quizQuestionIndex: learnedIndex,
          correctChoices,
        });
      }
      return;
    }

    if (id === 1) {
      if (!this.quizAnswers) {
        this.maybeRequestQuizAnswers(content, runId);
      }
      if (this.autoAnswer) {
        this.prefetchSearchForCurrentQuestion();
      }
      return;
    }

    if (!this.autoAnswer || !this.readyToPlay || this.twoFactorPending) {
      return;
    }

    if (id === 2 || id === 43) {
      this.questionActive = true;
      this.questionStartTime = Date.now();
      if (isAnswerableBlockType(this.currentQuestionType)) {
        this.scheduleAutoAnswer(runId);
      }
    }
  }

  onMessage(raw, runId) {
    if (this.closed || runId !== this.runId) {
      return;
    }

    let messages;
    try {
      messages = JSON.parse(raw);
    } catch {
      return;
    }

    for (const message of messages) {
      if (this.closed || runId !== this.runId) {
        return;
      }

      const channel = message.channel || "";
      const data = parseData(message.data);

      if (channel === "/meta/handshake" && message.clientId) {
        this.clientId = message.clientId;
        const serverTime = (message.ext && message.ext.timesync) || {};
        const lag = Math.round((Date.now() - (serverTime.tc || 0) - (serverTime.p || 0)) / 2);
        const offset = (serverTime.ts || 0) - (serverTime.tc || 0) - lag;
        this.timesync = { l: lag, o: offset };
        this.subscribeChannels();
        this.sendFirstConnect();
        continue;
      }

      if (channel === "/meta/subscribe") {
        continue;
      }

      if (channel === "/meta/connect" && message.ext) {
        if (message.advice && message.advice.reconnect === "retry" && !this.handshakeComplete) {
          this.handshakeComplete = true;
          this.login();
        }
        this.sendConnectPong(message);
        continue;
      }

      if (channel === "/service/controller" && data.type === "loginResponse") {
        this.handleLoginResponse(data, runId);
        continue;
      }

      if (channel === "/service/player") {
        this.handlePlayerMessage(data, runId);
        continue;
      }

      if (channel === "/service/status" && data.status === "LOCKED") {
        this.onError("This Kahoot game is locked.");
      }
    }
  }

  handleLoginResponse(data, runId) {
    if (runId !== this.runId || this.closed) {
      return;
    }

    if (data.error) {
      this.onError(data.description || data.error || "Login rejected");
      return;
    }

    if (!data.cid) {
      return;
    }

    this.cid = String(data.cid);
    this.sendNamerator();
    this.readyToPlay = true;
  }
}
