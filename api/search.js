const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
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

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueQueries(queries) {
  const seen = new Set();
  const result = [];
  for (const query of queries) {
    const trimmed = String(query || "").trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      continue;
    }
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
}

function buildSearchQueries(question, choices) {
  const choiceList = choices.map((choice) => String(choice || "").trim()).filter(Boolean);
  const queries = [question];

  for (const choice of choiceList) {
    queries.push(`${question} ${choice}`);
    queries.push(`"${question}" "${choice}"`);
  }

  if (choiceList.length === 2) {
    queries.push(`${question} true or false`);
  }

  queries.push(`${question} answer`);
  return uniqueQueries(queries).slice(0, 8);
}

function scoreChoice(choice, corpus, titles) {
  const normalizedChoice = normalizeText(choice);
  if (!normalizedChoice) {
    return 0;
  }

  let score = 0;
  if (corpus.includes(normalizedChoice)) {
    score += 28;
  }

  const words = normalizedChoice.split(/\s+/).filter((word) => word.length > 2);
  for (const word of words) {
    if (corpus.includes(word)) {
      score += 5;
    }
  }

  for (const title of titles) {
    const normalizedTitle = normalizeText(title);
    if (!normalizedTitle) {
      continue;
    }
    if (normalizedTitle === normalizedChoice) {
      score += 34;
    } else if (normalizedTitle.includes(normalizedChoice) || normalizedChoice.includes(normalizedTitle)) {
      score += 18;
    }
  }

  if (normalizedChoice === "true" || normalizedChoice === "false") {
    const patterns = [
      ` is ${normalizedChoice}`,
      ` ${normalizedChoice}.`,
      `answer is ${normalizedChoice}`,
      ` ${normalizedChoice} `,
    ];
    for (const pattern of patterns) {
      if (corpus.includes(pattern)) {
        score += 10;
      }
    }
  }

  return score;
}

async function googleCustomSearch(query) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cx) {
    return null;
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "8");
  url.searchParams.set("hl", "en");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json().catch(() => null);
  const items = data?.items || [];
  return {
    source: "google-api",
    snippets: items.map((item) => `${item.title || ""} ${item.snippet || ""}`.trim()).filter(Boolean),
    titles: items.map((item) => item.title || "").filter(Boolean),
  };
}

function parseGoogleHtml(html) {
  const snippets = [];
  const titles = [];

  const patterns = [
    /<div[^>]*class="[^"]*VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<span[^>]*class="[^"]*hgKElc[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    /<div[^>]*class="[^"]*kno-rdesc[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class="[^"]*BNeawe[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<h3[^>]*>([\s\S]*?)<\/h3>/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      const text = stripHtml(match[1]);
      if (text.length >= 8) {
        if (pattern.source.includes("h3")) {
          titles.push(text);
        } else {
          snippets.push(text);
        }
      }
      match = pattern.exec(html);
    }
  }

  if (!snippets.length) {
    const plain = stripHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " "),
    );
    if (plain.length > 40) {
      snippets.push(plain.slice(0, 12000));
    }
  }

  return {
    source: "google-scrape",
    snippets,
    titles,
  };
}

async function googleHtmlSearch(query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("num", "8");
  url.searchParams.set("pws", "0");
  url.searchParams.set("gbv", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  if (!html || /unusual traffic|captcha|consent\.google/i.test(html)) {
    return null;
  }

  const parsed = parseGoogleHtml(html);
  if (!parsed.snippets.length && !parsed.titles.length) {
    return null;
  }
  return parsed;
}

async function serperSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      q: query,
      num: 8,
      hl: "en",
      gl: "us",
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json().catch(() => null);
  const organic = data?.organic || [];
  const answerBox = data?.answerBox;
  const snippets = [];
  const titles = [];

  if (answerBox?.answer) {
    snippets.push(String(answerBox.answer));
  }
  if (answerBox?.snippet) {
    snippets.push(String(answerBox.snippet));
  }
  if (answerBox?.title) {
    titles.push(String(answerBox.title));
  }

  for (const item of organic) {
    if (item?.title) {
      titles.push(String(item.title));
    }
    if (item?.snippet) {
      snippets.push(String(item.snippet));
    }
  }

  if (!snippets.length && !titles.length) {
    return null;
  }

  return {
    source: "google-serper",
    snippets,
    titles,
  };
}

function parseDuckDuckGoHtml(html) {
  const snippets = [];
  const titles = [];

  const snippetPattern = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const titlePattern = /class="result__a"[^>]*>([\s\S]*?)<\/a>/gi;

  let match = snippetPattern.exec(html);
  while (match) {
    const text = stripHtml(match[1]);
    if (text.length >= 8) {
      snippets.push(text);
    }
    match = snippetPattern.exec(html);
  }

  match = titlePattern.exec(html);
  while (match) {
    const text = stripHtml(match[1]);
    if (text.length >= 3) {
      titles.push(text);
    }
    match = titlePattern.exec(html);
  }

  return { snippets, titles };
}

async function duckDuckGoSearch(query) {
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      q: query,
      kl: "us-en",
    }),
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const parsed = parseDuckDuckGoHtml(html);
  if (!parsed.snippets.length && !parsed.titles.length) {
    return null;
  }

  return {
    source: "google",
    snippets: parsed.snippets,
    titles: parsed.titles,
  };
}

async function wikipediaSearch(query) {
  const search = await fetch(
    `https://en.wikipedia.org/w/api.php?${new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query.slice(0, 220),
      srlimit: "3",
      utf8: "1",
      format: "json",
      origin: "*",
    })}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    },
  );

  if (!search.ok) {
    return null;
  }

  const searchData = await search.json().catch(() => null);
  const titles = (searchData?.query?.search || []).map((entry) => entry.title).filter(Boolean);
  if (!titles.length) {
    return null;
  }

  const extracts = await fetch(
    `https://en.wikipedia.org/w/api.php?${new URLSearchParams({
      action: "query",
      prop: "extracts",
      explaintext: "1",
      exintro: "1",
      exsentences: "8",
      titles: titles.join("|"),
      redirects: "1",
      format: "json",
      origin: "*",
    })}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    },
  );

  if (!extracts.ok) {
    return null;
  }

  const extractData = await extracts.json().catch(() => null);
  const pages = extractData?.query?.pages || {};
  const snippets = Object.values(pages)
    .map((page) => String(page.extract || "").trim())
    .filter(Boolean);

  if (!snippets.length) {
    return null;
  }

  return {
    source: "google",
    snippets,
    titles,
  };
}

function isBlockedCorpus(corpus) {
  const value = normalizeText(corpus);
  return (
    !value ||
    value.length < 40 ||
    /consent\.google|unusual traffic|captcha|before you continue|accept all/i.test(value)
  );
}

function accumulateChoiceScores(choices, result, scores, weight = 1, onlyIndex = -1) {
  if (!result) {
    return;
  }

  const corpus = `${result.snippets.join("\n")}\n${result.titles.join("\n")}`;
  if (isBlockedCorpus(corpus)) {
    return;
  }

  const normalizedCorpus = corpus.toLowerCase();
  const indices = onlyIndex >= 0 ? [onlyIndex] : choices.map((_, index) => index);

  for (const index of indices) {
    const score = scoreChoice(choices[index], normalizedCorpus, result.titles);
    scores[index] += score * weight;
  }
}

async function runGoogleQuery(query) {
  const apiResult = await googleCustomSearch(query);
  if (apiResult?.snippets?.length || apiResult?.titles?.length) {
    return apiResult;
  }

  const serperResult = await serperSearch(query);
  if (serperResult?.snippets?.length || serperResult?.titles?.length) {
    return serperResult;
  }

  const ddgResult = await duckDuckGoSearch(query);
  if (ddgResult?.snippets?.length || ddgResult?.titles?.length) {
    return ddgResult;
  }

  return wikipediaSearch(query);
}

async function resolveFromGoogle(question, choices) {
  const normalizedQuestion = String(question || "").trim();
  if (!normalizedQuestion || choices.length < 2) {
    return {
      choiceIndex: null,
      textAnswer: null,
      confidence: 0,
      source: "invalid-input",
      queries: [],
      snippetCount: 0,
    };
  }

  const queries = [normalizedQuestion];
  const scores = choices.map(() => 0);
  const usedSources = new Set();
  let snippetCount = 0;

  const main = await runGoogleQuery(normalizedQuestion);
  if (main) {
    usedSources.add(main.source);
    snippetCount += main.snippets.length;
    accumulateChoiceScores(choices, main, scores, 2.5);
  }

  for (let index = 0; index < choices.length; index += 1) {
    const query = `${normalizedQuestion} "${choices[index]}"`;
    queries.push(query);
    const result = await runGoogleQuery(query);
    if (!result) {
      continue;
    }
    usedSources.add(result.source);
    snippetCount += result.snippets.length;
    accumulateChoiceScores(choices, result, scores, 1.2, index);

    const best = Math.max(...scores);
    const sorted = [...scores].sort((left, right) => right - left);
    const second = sorted[1] || 0;
    if (best >= 40 && best - second >= 15) {
      break;
    }
  }

  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < scores.length; index += 1) {
    if (scores[index] > bestScore) {
      bestScore = scores[index];
      bestIndex = index;
    }
  }

  if (bestIndex < 0 || bestScore < 5) {
    return {
      choiceIndex: null,
      textAnswer: null,
      confidence: bestScore,
      source: snippetCount > 0 ? "low-confidence" : "no-results",
      queries,
      snippetCount,
    };
  }

  const source = usedSources.has("google-api")
    ? "google-api"
    : usedSources.has("google-serper")
      ? "google-serper"
      : "google";

  return {
    choiceIndex: bestIndex,
    textAnswer: choices[bestIndex],
    confidence: bestScore,
    source,
    queries,
    snippetCount,
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
    const result = await resolveFromGoogle(question, choices);
    return Response.json(result, { headers: corsHeaders() });
  } catch {
    return Response.json(
      {
        choiceIndex: null,
        textAnswer: null,
        confidence: 0,
        source: "error",
        queries: [],
        snippetCount: 0,
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
