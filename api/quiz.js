const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function kahootHeaders(origin = "https://kahoot.it") {
  return {
    Accept: "application/json, text/plain, */*",
    Referer: `${origin}/`,
    Origin: origin,
    "User-Agent": USER_AGENT,
  };
}

function isAnswerableType(type) {
  const value = String(type || "quiz").toLowerCase();
  return value && value !== "content";
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function normalizeTitle(title) {
  return stripHtml(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseChoiceCounts(raw) {
  if (!raw) {
    return [];
  }
  return String(raw)
    .split(",")
    .map((value) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === "null") {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    });
}

function getChoiceCount(question) {
  return (question?.choices || []).length;
}

function normalizeImageUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return "";
}

function extractImageUrl(question) {
  return normalizeImageUrl(
    question?.image ||
      question?.cover ||
      question?.resources ||
      question?.media?.url ||
      question?.video?.fullImage ||
      "",
  );
}

function extractAnswers(questions) {
  const answers = [];
  const answersByBlockIndex = [];

  for (let blockIndex = 0; blockIndex < (questions || []).length; blockIndex += 1) {
    const question = questions[blockIndex];
    const type = question.type || "quiz";
    const choices = question.choices || [];

    if (!isAnswerableType(type) || choices.length === 0) {
      answersByBlockIndex[blockIndex] = null;
      continue;
    }

    const correctIndices = [];
    for (let index = 0; index < choices.length; index += 1) {
      if (choices[index]?.correct) {
        correctIndices.push(index);
      }
    }

    const choiceLabels = choices
      .map((choice, index) => {
        const text = stripHtml(choice.answer || choice.text || choice.label || "");
        if (text) {
          return text;
        }
        if (normalizeImageUrl(choice.image)) {
          return `image choice ${index + 1}`;
        }
        return "";
      })
      .filter(Boolean);

    const choiceImages = choices
      .map((choice) => normalizeImageUrl(choice.image))
      .filter(Boolean);

    const entry = {
      type,
      layout: question.layout || question.questionFormat || "",
      numChoices: choices.length || question.numberOfAnswers || 4,
      correctIndices,
      question: stripHtml(question.question || question.title || question.description || ""),
      choiceLabels,
      imageUrl: extractImageUrl(question),
      choiceImages,
      textAnswers: choices
        .filter((choice) => choice?.correct && choice?.answer)
        .map((choice) => stripHtml(choice.answer))
        .filter(Boolean),
    };

    answersByBlockIndex[blockIndex] = entry;
    answers.push(entry);
  }

  return {
    answers,
    answersByBlockIndex,
    blockCount: (questions || []).length,
  };
}

function matchesQuizLayout(questions, choiceCounts) {
  if (!Array.isArray(questions) || !choiceCounts?.length) {
    return false;
  }

  if (questions.length === choiceCounts.length) {
    let matches = true;
    for (let index = 0; index < questions.length; index += 1) {
      const expected = choiceCounts[index];
      const actual = getChoiceCount(questions[index]);
      if (expected == null || expected === 0) {
        if (actual === 0) {
          continue;
        }
        if ((questions[index]?.type || "quiz") === "content") {
          continue;
        }
        matches = false;
        break;
      }
      if (actual !== expected) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  const positiveCounts = choiceCounts.filter((count) => count != null && count > 0);
  const answerableQuestions = (questions || []).filter(
    (question) => isAnswerableType(question.type || "quiz") && getChoiceCount(question) > 0,
  );

  if (positiveCounts.length !== answerableQuestions.length) {
    return false;
  }

  for (let index = 0; index < answerableQuestions.length; index += 1) {
    if (getChoiceCount(answerableQuestions[index]) !== positiveCounts[index]) {
      return false;
    }
  }

  return true;
}

function titleScore(searchTitle, candidateTitle) {
  const search = normalizeTitle(searchTitle);
  const candidate = normalizeTitle(candidateTitle);
  if (!search || !candidate) {
    return 0;
  }
  if (search === candidate) {
    return 1;
  }
  if (candidate.includes(search) || search.includes(candidate)) {
    return 0.92;
  }

  const searchWords = search.split(" ").filter((word) => word.length > 2);
  const candidateWords = new Set(candidate.split(" ").filter((word) => word.length > 2));
  if (!searchWords.length) {
    return 0;
  }

  const overlap = searchWords.filter((word) => candidateWords.has(word)).length;
  return overlap / searchWords.length;
}

function buildSearchQueries(title) {
  const cleaned = stripHtml(title);
  const queries = new Set();
  if (!cleaned) {
    return [];
  }

  const apostropheVariants = [
    cleaned,
    cleaned.replace(/'/g, "\u2019"),
    cleaned.replace(/[\u2019']/g, ""),
  ];

  for (const variant of apostropheVariants) {
    if (!variant) {
      continue;
    }
    queries.add(variant);

    const normalized = normalizeTitle(variant);
    if (normalized) {
      queries.add(normalized);
      const words = normalized.split(" ").filter((word) => word.length > 2);
      if (words.length >= 2) {
        queries.add(words.join(" "));
        queries.add(words.slice(-2).join(" "));
        queries.add(words.slice(0, 3).join(" "));
      }
      for (const word of words) {
        if (word.length >= 4) {
          queries.add(word);
        }
      }
    }
  }

  return [...queries].filter(Boolean);
}

function buildLayoutSearchQueries(choiceCounts) {
  const queries = new Set(["quiz", "review", "test"]);
  const positive = choiceCounts.filter((count) => count != null && count > 0);

  if (positive.length > 0 && positive.every((count) => count === 2)) {
    queries.add("true false");
    queries.add("yes no");
    queries.add("shape");
    queries.add("shapes");
  }

  if (positive.length > 0 && positive.every((count) => count === 4)) {
    queries.add("trivia");
    queries.add("general knowledge");
  }

  if (choiceCounts.some((count) => count === 0)) {
    queries.add("shape identifier");
    queries.add("shapes");
  }

  return [...queries];
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildQuizResult(quiz, candidate, title, source) {
  const extracted = extractAnswers(quiz.questions);
  if (!extracted.answers.some((entry) => entry.correctIndices?.length)) {
    return null;
  }

  return {
    quizId: candidate?.uuid || quiz.uuid,
    title: quiz.title || candidate?.cardTitle || title || "",
    ...extracted,
    source,
    matchScore: candidate?.score ?? 0,
  };
}

async function fetchQuizByUuid(quizId) {
  const endpoints = [
    ["https://create.kahoot.it", kahootHeaders("https://create.kahoot.it")],
    ["https://play.kahoot.it", kahootHeaders("https://play.kahoot.it")],
  ];

  for (const [origin, headers] of endpoints) {
    const quiz = await fetchJson(`${origin}/rest/kahoots/${encodeURIComponent(quizId)}`, headers);
    if (!quiz?.questions?.length) {
      continue;
    }
    const result = buildQuizResult(quiz, { uuid: quizId }, quiz.title, "uuid");
    if (result) {
      return result;
    }
  }

  return null;
}

async function searchKahootCatalog(query, origin) {
  const params = new URLSearchParams({
    query,
    cursor: "0",
    limit: "30",
    topics: "",
    grades: "",
    orderBy: "relevance",
    searchCluster: "1",
    includeExtendedCounters: "false",
  });

  const data = await fetchJson(`${origin}/rest/kahoots/?${params.toString()}`, kahootHeaders(origin));
  return data?.entities || [];
}

async function collectCandidates(queries, title, choiceCounts) {
  const normalizedTitle = normalizeTitle(title);
  const seen = new Set();
  const candidates = [];

  for (const query of queries) {
    for (const origin of ["https://create.kahoot.it", "https://play.kahoot.it"]) {
      const entities = await searchKahootCatalog(query, origin);
      for (const entity of entities) {
        const card = entity.card || {};
        const uuid = card.uuid;
        if (!uuid || seen.has(uuid)) {
          continue;
        }
        seen.add(uuid);

        const cardTitle = card.title || "";
        const score = title ? titleScore(title, cardTitle) : 0;
        if (title && score < 0.34 && normalizeTitle(cardTitle) !== normalizedTitle) {
          continue;
        }

        candidates.push({ uuid, cardTitle, score });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates;
}

async function pickMatchingQuiz(candidates, choiceCounts, title, source) {
  const exactMatches = [];
  const layoutMatches = [];
  const limited = candidates.slice(0, 12);

  for (const candidate of limited) {
    const quiz = await fetchJson(
      `https://create.kahoot.it/rest/kahoots/${encodeURIComponent(candidate.uuid)}`,
      kahootHeaders("https://create.kahoot.it"),
    );
    if (!quiz?.questions?.length || !matchesQuizLayout(quiz.questions, choiceCounts)) {
      continue;
    }

    const result = buildQuizResult(quiz, candidate, title, source);
    if (!result) {
      continue;
    }

    if (candidate.score >= 0.99) {
      return result;
    }

    if (candidate.score >= 0.8) {
      exactMatches.push(result);
    } else {
      layoutMatches.push(result);
    }
  }

  return exactMatches[0] || layoutMatches[0] || null;
}

async function searchQuizByTitle(title, choiceCounts) {
  if (!title || !choiceCounts?.length) {
    return null;
  }

  const candidates = await collectCandidates(buildSearchQueries(title), title, choiceCounts);
  return pickMatchingQuiz(candidates, choiceCounts, title, "title-search");
}

async function searchQuizByLayout(choiceCounts) {
  if (!choiceCounts?.length) {
    return null;
  }

  const candidates = await collectCandidates(buildLayoutSearchQueries(choiceCounts), "", choiceCounts);
  const matches = [];
  const limited = candidates.slice(0, 12);

  for (const candidate of limited) {
    const quiz = await fetchJson(
      `https://create.kahoot.it/rest/kahoots/${encodeURIComponent(candidate.uuid)}`,
      kahootHeaders("https://create.kahoot.it"),
    );
    if (!quiz?.questions?.length || !matchesQuizLayout(quiz.questions, choiceCounts)) {
      continue;
    }
    const result = buildQuizResult(quiz, candidate, quiz.title, "layout-search");
    if (result) {
      matches.push(result);
    }
  }

  if (matches.length === 1) {
    return matches[0];
  }

  return null;
}

async function resolveQuizAnswers({ title, choiceCounts, quizId }) {
  if (quizId) {
    const byId = await fetchQuizByUuid(quizId);
    if (byId) {
      return byId;
    }
  }

  if (title && choiceCounts?.length) {
    const byTitle = await searchQuizByTitle(title, choiceCounts);
    if (byTitle) {
      return byTitle;
    }
  }

  if (choiceCounts?.length) {
    return searchQuizByLayout(choiceCounts);
  }

  return null;
}

async function fetchQuizByPin(pin) {
  const pinData = await fetchJson(
    `https://kahoot.it/rest/challenges/pin/${encodeURIComponent(pin)}`,
    kahootHeaders("https://kahoot.it"),
  );
  if (!pinData) {
    return null;
  }

  const quizId = pinData.id || pinData.uuid || pinData.quizId;
  if (!quizId) {
    return null;
  }

  const quiz = await fetchQuizByUuid(quizId);
  if (quiz) {
    return { ...quiz, source: "pin" };
  }
  return null;
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function GET(request) {
  const url = new URL(request.url);
  const pin = (url.searchParams.get("pin") || "").replace(/\s+/g, "");
  const title = url.searchParams.get("title") || "";
  const quizId = url.searchParams.get("quizId") || "";
  const counts = parseChoiceCounts(url.searchParams.get("counts"));

  try {
    if (quizId || title || counts.length) {
      const result = await resolveQuizAnswers({ title, choiceCounts: counts, quizId });
      if (!result) {
        return Response.json(
          { error: "Could not find a public quiz matching that title and question layout." },
          { status: 404, headers: corsHeaders() },
        );
      }
      return Response.json(result, { headers: corsHeaders() });
    }

    if (!pin || !/^\d{6,}$/.test(pin)) {
      return Response.json({ error: "Invalid PIN" }, { status: 400, headers: corsHeaders() });
    }

    const pinResult = await fetchQuizByPin(pin);
    if (pinResult) {
      return Response.json(pinResult, { headers: corsHeaders() });
    }

    return Response.json(
      {
        error: "Live game PINs cannot be looked up directly. Answers load when the quiz starts.",
        livePin: true,
      },
      { status: 404, headers: corsHeaders() },
    );
  } catch (error) {
    return Response.json(
      { error: error.message || "Server error" },
      { status: 500, headers: corsHeaders() },
    );
  }
}
