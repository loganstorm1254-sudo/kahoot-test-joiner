const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "KahootJoiner/1.0 (https://github.com/loganstorm1254-sudo/kahoot-test-joiner)";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

function normalizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseChoices(raw) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((value) => String(value || "").trim()).filter(Boolean) : [];
  } catch {
    return String(raw)
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
  }
}

async function wikiFetch(params) {
  const url = new URL(WIKI_API);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function scoreChoice(choice, corpus, titles) {
  const normalizedChoice = normalizeText(choice);
  if (!normalizedChoice) {
    return 0;
  }

  let score = 0;
  if (corpus.includes(normalizedChoice)) {
    score += 24;
  }

  const words = normalizedChoice.split(/\s+/).filter((word) => word.length > 2);
  for (const word of words) {
    if (corpus.includes(word)) {
      score += 4;
    }
  }

  for (const title of titles) {
    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) {
      continue;
    }
    if (normalizedTitle === normalizedChoice) {
      score += 30;
    } else if (normalizedTitle.includes(normalizedChoice) || normalizedChoice.includes(normalizedTitle)) {
      score += 16;
    }
  }

  if (normalizedChoice === "true" || normalizedChoice === "false") {
    if (corpus.includes(` ${normalizedChoice} `) || corpus.startsWith(`${normalizedChoice} `)) {
      score += 8;
    }
  }

  return score;
}

async function resolveFromWikipedia(question, choices) {
  const normalizedQuestion = String(question || "").trim();
  if (!normalizedQuestion || choices.length < 2) {
    return { choiceIndex: null, textAnswer: null, confidence: 0, source: "invalid-input" };
  }

  const search = await wikiFetch({
    action: "query",
    list: "search",
    srsearch: normalizedQuestion.slice(0, 220),
    srlimit: "4",
    utf8: "1",
  });

  const titles = (search?.query?.search || []).map((entry) => entry.title).filter(Boolean);
  if (!titles.length) {
    return { choiceIndex: null, textAnswer: null, confidence: 0, source: "no-results" };
  }

  const extracts = await wikiFetch({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    exintro: "1",
    exsentences: "8",
    titles: titles.join("|"),
    redirects: "1",
  });

  const pages = extracts?.query?.pages || {};
  const corpus = Object.values(pages)
    .map((page) => String(page.extract || ""))
    .join("\n")
    .toLowerCase();

  if (!corpus.trim()) {
    return { choiceIndex: null, textAnswer: null, confidence: 0, source: "no-extract" };
  }

  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < choices.length; index += 1) {
    const score = scoreChoice(choices[index], corpus, titles);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestIndex < 0 || bestScore < 6) {
    return { choiceIndex: null, textAnswer: null, confidence: bestScore, source: "low-confidence" };
  }

  return {
    choiceIndex: bestIndex,
    textAnswer: choices[bestIndex],
    confidence: bestScore,
    source: "wikipedia",
    article: titles[0] || null,
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function GET(request) {
  const url = new URL(request.url);
  const question = url.searchParams.get("question") || "";
  const choices = parseChoices(url.searchParams.get("choices"));

  try {
    const result = await resolveFromWikipedia(question, choices);
    return Response.json(result, { headers: corsHeaders() });
  } catch {
    return Response.json(
      { choiceIndex: null, textAnswer: null, confidence: 0, source: "error" },
      { status: 500, headers: corsHeaders() },
    );
  }
}
