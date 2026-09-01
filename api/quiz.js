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

function extractAnswers(questions) {
  const answers = [];
  for (const question of questions || []) {
    const type = question.type || "quiz";
    const choices = question.choices || [];

    if (!isAnswerableType(type) || choices.length === 0) {
      continue;
    }

    const correctIndices = [];
    for (let index = 0; index < choices.length; index += 1) {
      if (choices[index]?.correct) {
        correctIndices.push(index);
      }
    }

    answers.push({
      type,
      layout: question.layout || question.questionFormat || "",
      numChoices: choices.length || question.numberOfAnswers || 4,
      correctIndices,
      textAnswers: choices
        .filter((choice) => choice?.correct && choice?.answer)
        .map((choice) => stripHtml(choice.answer))
        .filter(Boolean),
    });
  }
  return answers;
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
  if (cleaned) {
    queries.add(cleaned);
  }

  const normalized = normalizeTitle(cleaned);
  if (normalized) {
    queries.add(normalized);
    const words = normalized.split(" ").filter((word) => word.length > 2);
    if (words.length >= 2) {
      queries.add(words.join(" "));
      queries.add(words.slice(0, 3).join(" "));
    }
    for (const word of words) {
      if (word.length >= 4) {
        queries.add(word);
      }
    }
  }

  return [...queries].filter(Boolean);
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
    const answers = extractAnswers(quiz.questions);
    if (answers.some((entry) => entry.correctIndices?.length)) {
      return {
        quizId,
        title: quiz.title || "",
        answers,
        source: "uuid",
      };
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

async function searchQuizByTitle(title, choiceCounts) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle && !choiceCounts?.length) {
    return null;
  }

  const queries = buildSearchQueries(title);
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
        const score = titleScore(title, cardTitle);
        if (score < 0.34 && normalizeTitle(cardTitle) !== normalizedTitle) {
          continue;
        }

        candidates.push({
          uuid,
          cardTitle,
          score,
        });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  const exactMatches = [];
  const layoutMatches = [];

  for (const candidate of candidates) {
    const quiz = await fetchJson(
      `https://create.kahoot.it/rest/kahoots/${encodeURIComponent(candidate.uuid)}`,
      kahootHeaders("https://create.kahoot.it"),
    );
    if (!quiz?.questions?.length) {
      continue;
    }
    if (!matchesQuizLayout(quiz.questions, choiceCounts)) {
      continue;
    }

    const result = {
      quizId: candidate.uuid,
      title: quiz.title || candidate.cardTitle || title,
      answers: extractAnswers(quiz.questions),
      source: "title-search",
      matchScore: candidate.score,
    };

    if (candidate.score >= 0.99) {
      exactMatches.push(result);
    } else {
      layoutMatches.push(result);
    }
  }

  return exactMatches[0] || layoutMatches[0] || null;
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
    if (quizId) {
      const result = await fetchQuizByUuid(quizId);
      if (!result) {
        return Response.json({ error: "Could not load quiz by ID." }, { status: 404, headers: corsHeaders() });
      }
      return Response.json(result, { headers: corsHeaders() });
    }

    if (title) {
      const result = await searchQuizByTitle(title, counts);
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
