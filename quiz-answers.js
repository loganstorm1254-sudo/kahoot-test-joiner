const learnedAnswersByPin = new Map();
const cacheByPin = new Map();
const cacheByTitle = new Map();
const inflight = new Map();

export function normalizePin(pin) {
  return String(pin || "").replace(/\s+/g, "");
}

export function isValidPin(pin) {
  return /^\d{6,}$/.test(normalizePin(pin));
}

function cacheKeyForTitle(title, counts) {
  return `${String(title || "").trim().toLowerCase()}::${(counts || []).join(",")}`;
}

export function rememberCorrectChoices(pin, quizQuestionIndex, correctChoices) {
  const normalizedPin = normalizePin(pin);
  if (!normalizedPin || quizQuestionIndex == null || quizQuestionIndex < 0) {
    return;
  }
  if (!Array.isArray(correctChoices) || correctChoices.length === 0) {
    return;
  }

  let pinCache = learnedAnswersByPin.get(normalizedPin);
  if (!pinCache) {
    pinCache = new Map();
    learnedAnswersByPin.set(normalizedPin, pinCache);
  }

  pinCache.set(quizQuestionIndex, [...correctChoices]);
}

export function getLearnedCorrectIndices(pin, quizQuestionIndex) {
  const pinCache = learnedAnswersByPin.get(normalizePin(pin));
  return pinCache?.get(quizQuestionIndex) || null;
}

export function clearLearnedAnswers(pin) {
  learnedAnswersByPin.delete(normalizePin(pin));
}

export function getCachedQuizAnswers(pin) {
  return cacheByPin.get(normalizePin(pin)) || null;
}

export function clearQuizCache(pin) {
  const normalizedPin = normalizePin(pin);
  cacheByPin.delete(normalizedPin);
  inflight.delete(`pin:${normalizedPin}`);
}

function storeQuizAnswers(data, { pin, title, counts } = {}) {
  if (!data?.answers?.length) {
    return null;
  }
  if (pin) {
    cacheByPin.set(normalizePin(pin), data);
  }
  if (title) {
    cacheByTitle.set(cacheKeyForTitle(title, counts), data);
  }
  return data;
}

async function fetchQuizApi(query) {
  const response = await fetch(`/api/quiz?${query}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    return null;
  }
  if (!Array.isArray(data.answers) || data.answers.length === 0) {
    return null;
  }
  return data;
}

export async function fetchQuizAnswers(pin, { force = false } = {}) {
  const normalizedPin = normalizePin(pin);
  if (!isValidPin(normalizedPin)) {
    return null;
  }

  if (!force && cacheByPin.has(normalizedPin)) {
    return cacheByPin.get(normalizedPin);
  }

  const data = await fetchQuizApi(`pin=${encodeURIComponent(normalizedPin)}`);
  return storeQuizAnswers(data, { pin: normalizedPin });
}

export async function fetchQuizByTitle(title, choiceCounts, pin, quizId) {
  const counts = Array.isArray(choiceCounts) ? choiceCounts : [];
  const cacheKey = cacheKeyForTitle(title, counts);
  if (cacheByTitle.has(cacheKey)) {
    const cached = cacheByTitle.get(cacheKey);
    if (pin) {
      cacheByPin.set(normalizePin(pin), cached);
    }
    return cached;
  }

  const inflightKey = quizId ? `id:${quizId}` : `title:${cacheKey}`;
  if (inflight.has(inflightKey)) {
    return inflight.get(inflightKey);
  }

  const promise = (async () => {
    const params = new URLSearchParams();
    if (quizId) {
      params.set("quizId", String(quizId));
    } else {
      params.set("title", String(title || ""));
      params.set("counts", counts.join(","));
    }
    const data = await fetchQuizApi(params.toString());
    return storeQuizAnswers(data, { pin, title, counts });
  })().finally(() => {
    inflight.delete(inflightKey);
  });

  inflight.set(inflightKey, promise);
  return promise;
}

export function prefetchQuizAnswers(pin, { force = false } = {}) {
  const normalizedPin = normalizePin(pin);
  if (!isValidPin(normalizedPin)) {
    return Promise.resolve(null);
  }

  if (!force && cacheByPin.has(normalizedPin)) {
    return Promise.resolve(cacheByPin.get(normalizedPin));
  }

  const inflightKey = `pin:${normalizedPin}`;
  if (inflight.has(inflightKey)) {
    return inflight.get(inflightKey);
  }

  const promise = fetchQuizAnswers(normalizedPin, { force }).finally(() => {
    inflight.delete(inflightKey);
  });

  inflight.set(inflightKey, promise);
  return promise;
}

export function resolveChoice(type, numChoices, quizQuestionIndex, quizData, pin) {
  const normalizedType = String(type || "quiz").toLowerCase();
  let correctIndices =
    quizData?.answers?.[quizQuestionIndex]?.correctIndices ||
    getLearnedCorrectIndices(pin, quizQuestionIndex);

  if (!correctIndices?.length) {
    return Math.floor(Math.random() * Math.max(numChoices, 1));
  }

  if (normalizedType === "multiple_select_quiz" || normalizedType === "multiple_select_poll") {
    return correctIndices.filter((index) => index >= 0 && index < numChoices);
  }

  if (normalizedType === "jumble") {
    if (correctIndices.length === numChoices) {
      return [...correctIndices];
    }
    return Array.from({ length: Math.max(numChoices, 4) }, (_, index) => index);
  }

  const choice = correctIndices.find((index) => index >= 0 && index < numChoices);
  if (choice != null) {
    return choice;
  }

  return correctIndices[0] ?? 0;
}
