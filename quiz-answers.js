const learnedAnswersByPin = new Map();

export function rememberCorrectChoices(pin, quizQuestionIndex, correctChoices) {
  if (!pin || quizQuestionIndex == null || quizQuestionIndex < 0) {
    return;
  }
  if (!Array.isArray(correctChoices) || correctChoices.length === 0) {
    return;
  }

  let pinCache = learnedAnswersByPin.get(pin);
  if (!pinCache) {
    pinCache = new Map();
    learnedAnswersByPin.set(pin, pinCache);
  }

  pinCache.set(quizQuestionIndex, [...correctChoices]);
}

export function getLearnedCorrectIndices(pin, quizQuestionIndex) {
  const pinCache = learnedAnswersByPin.get(pin);
  return pinCache?.get(quizQuestionIndex) || null;
}

export function clearLearnedAnswers(pin) {
  learnedAnswersByPin.delete(pin);
}

export async function fetchQuizAnswers(pin) {
  const response = await fetch(`/api/quiz?pin=${encodeURIComponent(pin)}`);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    return null;
  }

  if (!Array.isArray(data.answers) || data.answers.length === 0) {
    return null;
  }

  return data;
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
