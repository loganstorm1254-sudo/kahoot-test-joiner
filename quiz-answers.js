import { buildInlineImages } from "./stormy-client.js";
import { stormyFetch } from "./site-fetch.js";

const learnedAnswersByPin = new Map();
const cacheByPin = new Map();
const cacheByTitle = new Map();
const inflight = new Map();
const searchCache = new Map();
const searchInflight = new Map();
const smartGuessCache = new Map();

const KAHOOT_COLOR_LABELS = ["Red", "Blue", "Yellow", "Green", "Purple", "Cyan"];

export function synthesizeChoiceLabels(numChoices, existing = []) {
  const count = Math.max(Number(numChoices) || 0, existing?.length || 0, 2);
  const labels = [];
  for (let index = 0; index < count; index += 1) {
    const existingLabel = String(existing?.[index] || "").trim();
    if (existingLabel && !/^image choice \d+$/i.test(existingLabel)) {
      labels.push(existingLabel);
    } else if (existingLabel) {
      labels.push(existingLabel);
    } else {
      labels.push(KAHOOT_COLOR_LABELS[index] || `Option ${index + 1}`);
    }
  }
  return labels;
}

export function getSharedSmartGuess(key) {
  return smartGuessCache.get(String(key || "")) ?? null;
}

export function setSharedSmartGuess(key, choiceIndex) {
  if (key == null || choiceIndex == null || choiceIndex < 0) {
    return;
  }
  smartGuessCache.set(String(key), choiceIndex);
}

export function smartGuessKey(pin, questionIndex, question, labels) {
  return [
    normalizePin(pin),
    questionIndex ?? "",
    normalizeTitle(question),
    (labels || []).map((label) => normalizeTitle(label)).join("|"),
  ].join("::");
}

/** Stable non-random fallback so every bot picks the same option. */
export function deterministicChoice(seed, numChoices) {
  const count = Math.max(Number(numChoices) || 1, 1);
  const text = String(seed || "stormy");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % count;
}

export function normalizePin(pin) {
  return String(pin || "").replace(/\D/g, "");
}

export function formatPinForDisplay(pin) {
  const digits = normalizePin(pin);
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
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
  const response = await stormyFetch(`/api/quiz?${query}`);
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

function searchCacheKey(question, choices, imageUrl = "", choiceImages = []) {
  const imageKey = [imageUrl, ...(choiceImages || [])].map((value) => normalizeTitle(value)).join("|");
  return `${normalizeTitle(question)}::${choices.map((choice) => normalizeTitle(choice)).join("|")}::${imageKey}`;
}

export function prefetchSearchAnswer(question, choices, options = {}) {
  return lookupSearchAnswer(question, choices, { timeoutMs: 10000, ...options });
}

export function lookupSearchAnswer(
  question,
  choices,
  { timeoutMs = 12000, imageUrl = "", choiceImages = [], onSteps } = {},
) {
  const labels = (choices || []).map((choice) => String(choice || "").trim());
  const validLabels = labels.filter(Boolean);
  if (validLabels.length < 2) {
    return Promise.resolve(null);
  }

  const bareQuestion = String(question || "").trim();
  const searchQuestion =
    bareQuestion || `Which answer is correct?\n\nHere are the options:\n${validLabels.map((label, index) => `${index + 1}. ${label}`).join("\n")}`;

  const normalizedImageUrl = String(imageUrl || "").trim();
  const normalizedChoiceImages = (choiceImages || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const cacheKey = searchCacheKey(question, labels, normalizedImageUrl, normalizedChoiceImages);
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }
  if (searchInflight.has(cacheKey)) {
    return searchInflight.get(cacheKey);
  }

  const hasImages = Boolean(normalizedImageUrl || normalizedChoiceImages.length);

  const promise = Promise.race([
    (async () => {
      let inlineImages = null;
      if (hasImages) {
        inlineImages = await buildInlineImages(normalizedImageUrl, normalizedChoiceImages);
      }

      const response = await stormyFetch("/api/stormy-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: searchQuestion,
          choices: labels,
          imageUrl: normalizedImageUrl,
          choiceImages: normalizedChoiceImages,
          inlineImages,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (onSteps && Array.isArray(data?.steps)) {
        onSteps(data.steps);
      }

      const choiceIndex = Number(data?.choiceIndex);
      const margin = Number(data?.margin) || 0;
      const source = data?.source || "stormy";
      const acceptsSmartGuess =
        data?.smartGuess === true ||
        source === "smart-guess" ||
        source === "vision" ||
        source === "stormy-ai" ||
        source === "stormy-vision-inline";
      const minMargin = acceptsSmartGuess ? 0 : hasImages ? 1 : 2;

      if (
        !Number.isFinite(choiceIndex) ||
        choiceIndex < 0 ||
        choiceIndex >= labels.length ||
        (!acceptsSmartGuess && margin < minMargin)
      ) {
        return {
          choiceIndex: null,
          textAnswer: null,
          confidence: Number(data?.confidence) || 0,
          margin,
          source,
          queries: Array.isArray(data?.queries) ? data.queries : [],
          snippetCount: Number(data?.snippetCount) || 0,
          usedImage: Boolean(data?.usedImage),
          steps: Array.isArray(data?.steps) ? data.steps : [],
          imageDescription: data?.imageDescription || "",
          smartGuess: Boolean(data?.smartGuess),
        };
      }
      return {
        choiceIndex,
        textAnswer: data?.textAnswer || labels[choiceIndex],
        confidence: Number(data?.confidence) || 0,
        margin,
        source,
        queries: Array.isArray(data?.queries) ? data.queries : [],
        snippetCount: Number(data?.snippetCount) || 0,
        usedImage: Boolean(data?.usedImage),
        steps: Array.isArray(data?.steps) ? data.steps : [],
        imageDescription: data?.imageDescription || "",
        smartGuess: Boolean(data?.smartGuess) || source === "smart-guess",
      };
    })().catch(() => null),
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

export function isTrustedQuizAnswers(quizData, { liveQuizId = "", liveQuizTitle = "" } = {}) {
  if (!quizData?.answers?.length && !quizData?.answersByBlockIndex?.length) {
    return false;
  }
  if (quizData.source === "uuid" || quizData.source === "pin") {
    return true;
  }
  if (quizData.quizId && liveQuizId && String(quizData.quizId) === String(liveQuizId)) {
    return true;
  }
  if ((quizData.matchScore || 0) >= 0.85) {
    return true;
  }
  if (quizData.title && liveQuizTitle) {
    return normalizeTitle(quizData.title) === normalizeTitle(liveQuizTitle);
  }
  return false;
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
    return deterministicChoice(
      `${pin || ""}:${lookupIndex}:${quizData?.title || ""}:${quizQuestionIndex}`,
      numChoices,
    );
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
