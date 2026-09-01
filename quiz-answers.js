const learnedAnswersByPin = new Map();
const cacheByPin = new Map();
const cacheByTitle = new Map();
const inflight = new Map();
const searchCache = new Map();
const searchInflight = new Map();

export function normalizePin(pin) {
  return String(pin || "").replace(/\s+/g, "");
}

export function isValidPin(pin) {
  return /^\d{6,}$/.test(normalizePin(pin));
}

function cacheKeyForTitle(title, counts) {
  return `${normalizeTitle(title)}::${(counts || []).join(",")}`;
}

function cacheKeyForCounts(counts) {
  return `counts::${(counts || []).join(",")}`;
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
  if (!data?.answers?.length && !data?.answersByBlockIndex?.length) {
    return null;
  }
  if (pin) {
    cacheByPin.set(normalizePin(pin), data);
  }
  if (counts?.length) {
    cacheByTitle.set(cacheKeyForCounts(counts), data);
  }
  if (title) {
    cacheByTitle.set(cacheKeyForTitle(title, counts), data);
  }
  return data;
}

export function normalizeTitle(title) {
  return String(title || "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
  const cacheKey = title ? cacheKeyForTitle(title, counts) : cacheKeyForCounts(counts);

  if (cacheByTitle.has(cacheKey)) {
    const cached = cacheByTitle.get(cacheKey);
    if (pin) {
      cacheByPin.set(normalizePin(pin), cached);
    }
    return cached;
  }

  const inflightKey = quizId ? `id:${quizId}` : counts.length ? `lookup:${cacheKey}` : `title:${cacheKey}`;
  if (inflight.has(inflightKey)) {
    return inflight.get(inflightKey);
  }

  const promise = (async () => {
    const params = new URLSearchParams();
    if (quizId) {
      params.set("quizId", String(quizId));
    }
    if (title) {
      params.set("title", String(title));
    }
    if (counts.length) {
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

function searchCacheKey(question, choices) {
  return `${normalizeTitle(question)}::${choices.map((choice) => normalizeTitle(choice)).join("|")}`;
}

export function prefetchSearchAnswer(question, choices) {
  return lookupSearchAnswer(question, choices, { timeoutMs: 6000 });
}

export function lookupSearchAnswer(question, choices, { timeoutMs = 3500 } = {}) {
  const labels = (choices || []).map((choice) => String(choice || "").trim()).filter(Boolean);
  if (!String(question || "").trim() || labels.length < 2) {
    return Promise.resolve(null);
  }

  const cacheKey = searchCacheKey(question, labels);
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }
  if (searchInflight.has(cacheKey)) {
    return searchInflight.get(cacheKey);
  }

  const params = new URLSearchParams({
    question: String(question).trim(),
    choices: JSON.stringify(labels),
  });

  const promise = Promise.race([
    fetch(`/api/search?${params.toString()}`)
      .then((response) => response.json().catch(() => ({})))
      .then((data) => {
        const choiceIndex = Number(data?.choiceIndex);
        if (!Number.isFinite(choiceIndex) || choiceIndex < 0 || choiceIndex >= labels.length) {
          return {
            choiceIndex: null,
            textAnswer: null,
            confidence: Number(data?.confidence) || 0,
            source: data?.source || "google",
            queries: Array.isArray(data?.queries) ? data.queries : [],
            snippetCount: Number(data?.snippetCount) || 0,
          };
        }
        return {
          choiceIndex,
          textAnswer: data?.textAnswer || labels[choiceIndex],
          confidence: Number(data?.confidence) || 0,
          source: data?.source || "google",
          queries: Array.isArray(data?.queries) ? data.queries : [],
          snippetCount: Number(data?.snippetCount) || 0,
        };
      })
      .catch(() => null),
    new Promise((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    }),
  ])
    .then((result) => {
      searchCache.set(cacheKey, Promise.resolve(result));
      return result;
    })
    .finally(() => {
      searchInflight.delete(cacheKey);
    });

  searchInflight.set(cacheKey, promise);
  return promise;
}

export function resolveChoice(type, numChoices, quizQuestionIndex, quizData, pin, blockIndex) {
  const normalizedType = String(type || "quiz").toLowerCase();
  const lookupIndex = blockIndex != null ? blockIndex : quizQuestionIndex;
  const answerEntry =
    (blockIndex != null && quizData?.answersByBlockIndex?.[blockIndex]) ||
    quizData?.answers?.[quizQuestionIndex];

  let correctIndices =
    answerEntry?.correctIndices || getLearnedCorrectIndices(pin, lookupIndex);

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
