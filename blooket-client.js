import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

import { encryptBlooketPayload } from "./blooket-crypto.js";

const BLOOKET_JOIN_URL = "https://fb.blooket.com/c/firebase/join";

const BLOOKET_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCA-cTOnX19f6LFnDVVsHXya3k6ByP_MnU",
  authDomain: "blooket-2020.firebaseapp.com",
  projectId: "blooket-2020",
  storageBucket: "blooket-2020.appspot.com",
  messagingSenderId: "741533559105",
  appId: "1:741533559105:web:b8cbb10e6123f2913519c0",
  measurementId: "G-S3H5NGN10Z",
};

const DEFAULT_BLOOKS = [
  "Dog",
  "Cat",
  "Chicken",
  "Cow",
  "Pig",
  "Sheep",
  "Duck",
  "Horse",
  "Alpaca",
  "Walrus",
  "Wolf",
  "Bear",
  "Fox",
  "Rabbit",
  "Owl",
];

function randomBlook() {
  return DEFAULT_BLOOKS[Math.floor(Math.random() * DEFAULT_BLOOKS.length)];
}

function sanitizeAppName(name) {
  return `blooket-${String(name).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 24)}-${Date.now()}`;
}

export function normalizeBlooketGameId(value) {
  return String(value || "").replace(/\D/g, "");
}

export function isValidBlooketGameId(value) {
  const digits = normalizeBlooketGameId(value);
  return digits.length >= 5 && digits.length <= 7;
}

export function isValidBlooketGameId(value) {
  const digits = normalizeBlooketGameId(value);
  return digits.length >= 5 && digits.length <= 7;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBlooketBuildConfig() {
  const response = await fetch("/api/blooket-build");
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.buildId || !data.secret) {
    throw new Error(data.error || "Could not load Blooket build config.");
  }
  return data;
}

async function parseJoinResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { success: false, msg: `Invalid response (HTTP ${response.status}).` };
  }
  if (!data.success && !data.msg) {
    data.msg = "Could not join that game.";
  }
  data.httpStatus = response.status;
  return data;
}

async function joinBlooketFromBrowser(gameId, name, buildConfig) {
  const payload = { id: String(gameId), name: String(name) };
  const body = await encryptBlooketPayload(payload, buildConfig.secret);
  const response = await fetch(BLOOKET_JOIN_URL, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Blooket-Build": buildConfig.buildId,
    },
    body,
  });
  return parseJoinResponse(response);
}

async function requestBlooketJoinsFromBrowser(gameId, names) {
  const buildConfig = await loadBlooketBuildConfig();
  const joins = [];

  for (const name of names) {
    const joinData = await joinBlooketFromBrowser(gameId, name, buildConfig);
    joins.push({ name, ...joinData });
    await sleep(120);
  }

  const successCount = joins.filter((entry) => entry.success).length;
  return {
    success: successCount > 0,
    joins,
    successCount,
    totalCount: joins.length,
    msg:
      successCount === joins.length
        ? undefined
        : successCount === 0
          ? joins[0]?.msg || "Could not join that game."
          : `Joined ${successCount}/${joins.length} players.`,
  };
}

async function requestBlooketJoinsFromServer(gameId, names, signal) {
  const response = await fetch("/api/blooket-join", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: gameId, names }),
    signal,
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Server error (${response.status}). Hard refresh and retry.`);
  }
  if (!Array.isArray(data.joins)) {
    throw new Error(data.msg || `Join request failed (HTTP ${response.status}).`);
  }
  if (
    data.successCount === 0 &&
    data.joins.every((entry) => entry.httpStatus === 403 || /blocked by blooket/i.test(entry.msg || ""))
  ) {
    throw new Error(
      "Blooket blocks joins from Vercel. Deploy this repo on Cloudflare Pages instead (see README), or set BLOOKET_JOIN_WORKER_URL on Vercel.",
    );
  }
  return data;
}

export async function requestBlooketJoins(gameId, names) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    try {
      return await requestBlooketJoinsFromBrowser(gameId, names);
    } catch (browserError) {
      const blockedByCors =
        browserError instanceof TypeError ||
        /failed to fetch|cors|network/i.test(browserError?.message || "");
      if (!blockedByCors) {
        throw browserError;
      }
    }

    return await requestBlooketJoinsFromServer(gameId, names, controller.signal);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Join timed out — try fewer players or retry.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export class BlooketJoiner {
  constructor() {
    this.reset();
  }

  reset() {
    this.gameId = "";
    this.nickname = "";
    this.autoAnswer = false;
    this.onJoined = () => {};
    this.onError = () => {};
    this.onStatus = () => {};
    this.onActivity = () => {};
    this.joined = false;
    this.closed = false;
    this.firebaseApp = null;
    this.database = null;
    this.questionUnsubscribe = null;
    this.lastQuestionKey = "";
    this.blook = "Dog";
  }

  status(message) {
    this.onStatus(message);
  }

  log(message, level = "info") {
    this.onActivity({ steps: [{ message, level }] });
  }

  async connect({
    gameId,
    nickname,
    joinData,
    autoAnswer,
    onJoined,
    onError,
    onStatus,
    onActivity,
    blook,
  }) {
    this.stop(false);
    this.reset();

    this.gameId = normalizeBlooketGameId(gameId);
    this.nickname = String(nickname || "bot").trim().slice(0, 16) || "bot";
    this.autoAnswer = Boolean(autoAnswer);
    this.blook = blook || randomBlook();
    this.onJoined = onJoined || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onActivity = onActivity || (() => {});
    this.closed = false;

    if (!isValidBlooketGameId(this.gameId)) {
      this.onError("Enter a valid 5–7 digit game ID.");
      return false;
    }

    if (!joinData?.success || !joinData.fbToken || !joinData.fbShardURL) {
      this.onError(joinData?.msg || "Could not join that game.");
      return false;
    }

    try {
      this.status(`Joining as ${this.nickname}…`);

      const app = initializeApp(
        {
          ...BLOOKET_FIREBASE_CONFIG,
          databaseURL: joinData.fbShardURL,
        },
        sanitizeAppName(this.nickname),
      );
      this.firebaseApp = app;
      const auth = getAuth(app);
      await signInWithCustomToken(auth, joinData.fbToken);

      const db = getDatabase(app);
      this.database = db;

      await set(ref(db, `${this.gameId}/c/${this.nickname}`), {
        b: this.blook,
      });

      this.joined = true;
      this.status(`Joined as ${this.nickname} (${this.blook})`);
      this.log(`Joined game ${this.gameId} as ${this.nickname}`, "success");
      this.onJoined(this.nickname);

      if (this.autoAnswer) {
        this.watchQuestions();
      }
      return true;
    } catch (error) {
      this.onError(error.message || "Join failed.");
      this.stop(false);
      return false;
    }
  }

  watchQuestions() {
    if (!this.database || this.closed) {
      return;
    }

    const questionRef = ref(this.database, `${this.gameId}/q`);
    this.questionUnsubscribe = onValue(questionRef, (snapshot) => {
      if (this.closed || !this.joined) {
        return;
      }
      const question = snapshot.val();
      if (!question || typeof question !== "object") {
        return;
      }

      const questionKey = JSON.stringify({
        text: question.question || question.text || "",
        answers: question.answers || [],
      });
      if (!questionKey || questionKey === this.lastQuestionKey) {
        return;
      }
      this.lastQuestionKey = questionKey;

      this.answerQuestion(question).catch(() => {});
    });
  }

  async answerQuestion(question) {
    if (!this.database || this.closed) {
      return;
    }

    const answers = Array.isArray(question.answers) ? question.answers : [];
    const correctAnswers = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];
    if (!answers.length || !correctAnswers.length) {
      return;
    }

    let choiceIndex = answers.findIndex((answer) => correctAnswers.includes(answer));
    if (choiceIndex < 0) {
      choiceIndex = Math.floor(Math.random() * answers.length);
    }

    const delay = 400 + Math.floor(Math.random() * 1200);
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (this.closed || !this.joined) {
      return;
    }

    const answerValue = question.qType === "typing" ? answers[choiceIndex] : choiceIndex;
    await update(ref(this.database, `${this.gameId}/c/${this.nickname}`), {
      a: answerValue,
      tat: Date.now(),
    });

    const preview = String(question.question || question.text || "Question").slice(0, 60);
    this.log(`Answered Q: "${preview}" → choice ${choiceIndex + 1}`, "success");
    this.status(`Answered → choice ${choiceIndex + 1}`);
  }

  stop(markClosed = true) {
    if (markClosed) {
      this.closed = true;
    }
    this.joined = false;

    if (this.questionUnsubscribe) {
      this.questionUnsubscribe();
      this.questionUnsubscribe = null;
    }

    if (this.firebaseApp) {
      deleteApp(this.firebaseApp).catch(() => {});
      this.firebaseApp = null;
    }
    this.database = null;
  }

  isRunning() {
    return this.joined && !this.closed;
  }
}
