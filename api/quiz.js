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

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function GET(request) {
  const url = new URL(request.url);
  const pin = (url.searchParams.get("pin") || "").replace(/\s+/g, "");

  if (!pin || !/^\d{6,}$/.test(pin)) {
    return Response.json({ error: "Invalid PIN" }, { status: 400, headers: corsHeaders() });
  }

  try {
    const pinResponse = await fetch(`https://kahoot.it/rest/challenges/pin/${encodeURIComponent(pin)}`, {
      headers: kahootHeaders(),
    });

    if (!pinResponse.ok) {
      const message =
        pinResponse.status === 404
          ? "Could not resolve quiz from PIN. Is the game running?"
          : `Kahoot returned status ${pinResponse.status}`;
      return Response.json({ error: message }, { status: pinResponse.status, headers: corsHeaders() });
    }

    const pinData = await pinResponse.json();
    const quizId = pinData.id || pinData.uuid || pinData.quizId;
    if (!quizId) {
      return Response.json(
        { error: "Kahoot did not return a quiz id for this PIN" },
        { status: 502, headers: corsHeaders() },
      );
    }

    const quizResponse = await fetch(
      `https://play.kahoot.it/rest/kahoots/${encodeURIComponent(quizId)}`,
      { headers: kahootHeaders() },
    );

    if (!quizResponse.ok) {
      return Response.json(
        { error: `Failed to load quiz (${quizResponse.status})` },
        { status: quizResponse.status, headers: corsHeaders() },
      );
    }

    const quiz = await quizResponse.json();
    const answers = extractAnswers(quiz.questions);

    return Response.json(
      {
        quizId,
        title: quiz.title || "",
        answers,
      },
      { headers: corsHeaders() },
    );
  } catch (error) {
    return Response.json(
      { error: error.message || "Server error" },
      { status: 500, headers: corsHeaders() },
    );
  }
}
