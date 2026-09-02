import { encryptBlooketPayload } from "./blooket-crypto.js";
import { BLOOKET_JOIN_WORKER_URL, normalizeBlooketGameId } from "./blooket-shared.js";

const BLOOKET_JOIN_URL = "https://fb.blooket.com/c/firebase/join";
const BLOOKET_PLAY_ORIGIN = "https://play.blooket.com";

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

let firebaseModulesPromise;

function loadFirebaseModules() {
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"),
    ]).then(([app, auth, database]) => ({ app, auth, database }));
  }
  return firebaseModulesPromise;
}

function randomBlook() {
  return DEFAULT_BLOOKS[Math.floor(Math.random() * DEFAULT_BLOOKS.length)];
}

function sanitizeAppName(name) {
  return `blooket-${String(name).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 24)}-${Date.now()}`;
}

export { normalizeBlooketGameId } from "./blooket-shared.js";

export function isValidBlooketGameId(value) {
  const digits = normalizeBlooketGameId(value);
  return digits.length >= 5 && digits.length <= 7;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadBlooketBuildConfig() {
  try {
    const workerResponse = await fetch(BLOOKET_JOIN_WORKER_URL, { method: "GET" });
    const workerData = await workerResponse.json().catch(() => ({}));
    if (workerResponse.ok && workerData.buildId && workerData.secret) {
      return workerData;
    }
  } catch {
    // Fall back to the Vercel build route.
  }

  const response = await fetch("/api/blooket-build");
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.buildId || !data.secret) {
    throw new Error(data.error || "Could not load Blooket build config.");
  }
  return data;
}

async function joinBlooketPlain(gameId, name) {
  const response = await fetch(BLOOKET_JOIN_URL, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: String(gameId), name: String(name) }),
  });
  return parseJoinResponse(response);
}

async function joinBlooketEncrypted(gameId, name, buildConfig) {
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

async function parseJoinResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { success: false, msg: `Invalid response (HTTP ${response.status}).` };
  }
  if (!data.success && !data.msg) {
    data.msg =
      response.status === 403 ? "Blocked by Blooket (HTTP 403)." : "Could not join that game.";
  }
  data.httpStatus = response.status;
  return data;
}

async function joinBlooketFromBrowser(gameId, name, buildConfig = null) {
  let joinData = await joinBlooketPlain(gameId, name);
  if (!joinData.success) {
    const config = buildConfig || (await loadBlooketBuildConfig());
    joinData = await joinBlooketEncrypted(gameId, name, config);
  }
  return joinData;
}

async function requestBlooketJoinsFromBrowser(gameId, names) {
  let buildConfig = null;
  const joins = [];

  for (const name of names) {
    let joinData = await joinBlooketPlain(gameId, name);
    if (!joinData.success) {
      try {
        buildConfig ||= await loadBlooketBuildConfig();
        joinData = await joinBlooketEncrypted(gameId, name, buildConfig);
      } catch {
        // Keep the plain-join error if encrypted fallback cannot run.
      }
    }

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

export async function requestBlooketJoins(gameId, names) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    return await requestBlooketJoinsFromBrowser(gameId, names);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Join timed out — try fewer players or retry.");
    }
    if (error instanceof TypeError || /failed to fetch|cors|network/i.test(error?.message || "")) {
      throw new Error("Browser could not reach Blooket. Hard refresh and retry.");
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
    this.firebase = null;
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

      const { app: appModule, auth: authModule, database: databaseModule } = await loadFirebaseModules();
      this.firebase = { appModule, authModule, databaseModule };

      const app = appModule.initializeApp(
        {
          ...BLOOKET_FIREBASE_CONFIG,
          databaseURL: joinData.fbShardURL,
        },
        sanitizeAppName(this.nickname),
      );
      this.firebaseApp = app;
      const auth = authModule.getAuth(app);
      await authModule.signInWithCustomToken(auth, joinData.fbToken);

      const db = databaseModule.getDatabase(app);
      this.database = db;

      await databaseModule.set(databaseModule.ref(db, `${this.gameId}/c/${this.nickname}`), {
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
    if (!this.database || this.closed || !this.firebase) {
      return;
    }

    const { database: databaseModule } = this.firebase;
    const questionRef = databaseModule.ref(this.database, `${this.gameId}/q`);
    this.questionUnsubscribe = databaseModule.onValue(questionRef, (snapshot) => {
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
    if (!this.database || this.closed || !this.firebase) {
      return;
    }

    const { database: databaseModule } = this.firebase;
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
    await databaseModule.update(databaseModule.ref(this.database, `${this.gameId}/c/${this.nickname}`), {
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

    if (this.firebaseApp && this.firebase?.appModule) {
      this.firebase.appModule.deleteApp(this.firebaseApp).catch(() => {});
      this.firebaseApp = null;
    }
    this.database = null;
    this.firebase = null;
  }

  isRunning() {
    return this.joined && !this.closed;
  }
}
