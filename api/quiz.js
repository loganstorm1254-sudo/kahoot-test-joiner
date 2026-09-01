const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function kahootHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    Referer: "https://kahoot.it/",
    Origin: "https://kahoot.it",
    "User-Agent": USER_AGENT,
  };
}

function isAnswerableType(type) {
  return type && type !== "content";
}

function extractAnswers(questions) {
  const answers = [];
  for (const question of questions || []) {
    const type = question.type || "quiz";
    if (!isAnswerableType(type)) {
      continue;
    }

    const choices = question.choices || [];
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
        .map((choice) => String(choice.answer).replace(/<[^>]+>/g, "").trim())
        .filter(Boolean),
    });
  }
  return answers;
}

function parseChoiceCounts(raw) {
  if (!raw) {
    return [];
  }
  return String(raw)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function getAnswerableQuestions(questions) {
  return (questions || []).filter((question) => isAnswerableType(question.type || "quiz"));
}

function matchesChoiceCounts(questions, choiceCounts) {
  if (!choiceCounts.length) {
    return false;
  }
  const answerable = getAnswerableQuestions(questions);
  if (answerable.length !== choiceCounts.length) {
    return false;
  }
  for (let index = 0; index < choiceCounts.length; index += 1) {
    const choices = answerable[index].choices || [];
    if (choices.length !== choiceCounts[index]) {
      return false;
    }
  }
  return true;
}

function normalizeTitle(title) {
  return String(title || "")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase();
}

async function fetchQuizByUuid(quizId) {
  const endpoints = [
    `https://create.kahoot.it/rest/kahoots/${encodeURIComponent(quizId)}`,
    `https://play.kahoot.it/rest/kahoots/${encodeURIComponent(quizId)}`,
  ];

  for (const url of endpoints) {
    const response = await fetch(url, { headers: kahootHeaders() });
    if (!response.ok) {
      continue;
    }
    const quiz = await response.json();
    const answers = extractAnswers(quiz.questions);
    if (answers.length > 0) {
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

async function searchQuizByTitle(title, choiceCounts) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    return null;
  }

  const searchResponse = await fetch(
    `https://create.kahoot.it/rest/kahoots/?query=${encodeURIComponent(title)}&limit=30`,
    { headers: kahootHeaders() },
  );

  if (!searchResponse.ok) {
    return null;
  }

  const searchData = await searchResponse.json();
  const entities = searchData.entities || [];
  const exactMatches = [];
  const fuzzyMatches = [];

  for (const entity of entities) {
    const card = entity.card || {};
    const uuid = card.uuid;
    const cardTitle = normalizeTitle(card.title);
    if (!uuid) {
      continue;
    }

    const quizResponse = await fetch(
      `https://create.kahoot.it/rest/kahoots/${encodeURIComponent(uuid)}`,
      { headers: kahootHeaders() },
    );
    if (!quizResponse.ok) {
      continue;
    }

    const quiz = await quizResponse.json();
    if (!matchesChoiceCounts(quiz.questions, choiceCounts)) {
      continue;
    }

    const result = {
      quizId: uuid,
      title: quiz.title || card.title || title,
      answers: extractAnswers(quiz.questions),
      source: "title-search",
    };

    if (cardTitle === normalizedTitle) {
      exactMatches.push(result);
    } else {
      fuzzyMatches.push(result);
    }
  }

  return exactMatches[0] || fuzzyMatches[0] || null;
}

async function fetchQuizByPin(pin) {
  const pinResponse = await fetch(
    `https://kahoot.it/rest/challenges/pin/${encodeURIComponent(pin)}`,
    { headers: kahootHeaders() },
  );

  if (!pinResponse.ok) {
    return null;
  }

  const pinData = await pinResponse.json();
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
  const counts = parseChoiceCounts(url.searchParams.get("counts"));

  try {
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
