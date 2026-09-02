import { resolveKahootImageUrl } from "../kahoot-images.js";
import { stormyReasonPick } from "../lib/stormy-ai.js";

const STORMY_SEARCH_VERSION = "1.0";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-Stormy-Search": STORMY_SEARCH_VERSION,
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

function formatOptionsBlock(choices) {
  const choiceList = choices.map((choice) => String(choice || "").trim()).filter(Boolean);
  if (!choiceList.length) {
    return "";
  }
  return `Here are the options:\n${choiceList.map((choice, index) => `${index + 1}. ${choice}`).join("\n")}`;
}

function formatQuestionWithOptions(question, choices) {
  const optionsBlock = formatOptionsBlock(choices);
  if (!optionsBlock) {
    return String(question || "").trim();
  }
  return `${String(question || "").trim()}\n\n${optionsBlock}`;
}

function buildSearchQueries(question, choices) {
  const choiceList = choices.map((choice) => String(choice || "").trim()).filter(Boolean);
  const withOptions = formatQuestionWithOptions(question, choiceList);
  const queries = [question, withOptions];

  for (const choice of choiceList) {
    queries.push(`${question} ${choice}`);
    queries.push(`"${question}" "${choice}"`);
  }

  if (choiceList.length === 2) {
    queries.push(`${question} true or false`);
  }

  queries.push(`${question} answer`);
  queries.push(`${withOptions} which is correct`);
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

  const escapedChoice = normalizedChoice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`\\b${escapedChoice}\\b`, "i");
  if (boundary.test(corpus)) {
    score += 42;
  }

  const words = normalizedChoice.split(/\s+/).filter((word) => word.length > 2);
  for (const word of words) {
    if (corpus.includes(word)) {
      score += 5;
    }
    if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(corpus)) {
      score += 4;
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

function normalizeImageUrl(raw) {
  return resolveKahootImageUrl(raw);
}

function parseChoiceImages(raw) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((value) => normalizeImageUrl(value)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function areGenericImageLabels(choices) {
  if (!choices?.length) {
    return false;
  }
  return choices.every((choice) => /^image choice \d+$/i.test(String(choice).trim()));
}

function fuzzMatch(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  if (
    normalizedLeft.length >= 3 &&
    normalizedRight.length >= 3 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return true;
  }

  const leftTokens = normalizedLeft.split(/\s+/).filter((token) => token.length > 2);
  const rightTokens = new Set(normalizedRight.split(/\s+/).filter((token) => token.length > 2));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap >= 1;
}

async function fetchImageBytes(_imageUrl) {
  return null;
}

/** Free image path: reverse-image search titles/snippets (no Gemini/OpenAI). */
async function describeImageFromSearch(imageUrl) {
  if (!imageUrl) {
    return null;
  }
  const result = await runImageSearch(imageUrl, "");
  if (!result) {
    return null;
  }
  const text = [result.titles[0], result.titles[1], result.snippets[0]]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 200);
  return text ? { text, source: result.source || "image-search" } : null;
}

async function runVisionAnalysis(question, choices, imageUrl, choiceImages, steps) {
  const normalizedQuestionImage = normalizeImageUrl(imageUrl);
  const normalizedChoiceImages = (choiceImages || [])
    .map((url) => normalizeImageUrl(url))
    .filter(Boolean);
  const hasQuestionImage = Boolean(normalizedQuestionImage);
  const hasChoiceImages = normalizedChoiceImages.some(Boolean);

  if (!hasQuestionImage && !hasChoiceImages) {
    return {
      visionScores: null,
      imageDescription: "",
      visionCorpus: "",
      usedVision: false,
    };
  }

  steps.push({ message: "Stormy™ image search (free reverse lookup)…", level: "info" });

  let questionVision = null;
  if (hasQuestionImage) {
    questionVision = await describeImageFromSearch(normalizedQuestionImage);
    if (questionVision?.text) {
      steps.push({
        message: `Image match: ${questionVision.text}`,
        level: "info",
      });
    } else {
      steps.push({
        message: "No reverse-image match — scoring from text search instead",
        level: "warn",
      });
    }
  }

  const visionScores = choices.map(() => 0);
  const choiceDescriptions = [];
  let results = [];

  if (hasChoiceImages) {
    const paddedImages = choices.map((_, index) => normalizedChoiceImages[index] || "");
    results = await Promise.all(
      paddedImages.map((url) => (url ? describeImageFromSearch(url) : Promise.resolve(null))),
    );

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const label = choices[index] || `choice ${index + 1}`;
      if (result?.text) {
        choiceDescriptions.push(result.text);
        steps.push({
          message: `Image (${label}): ${result.text}`,
          level: "info",
        });
      }
    }

    const questionDesc = questionVision?.text || "";
    const questionNorm = normalizeText(question);

    for (let index = 0; index < choices.length; index += 1) {
      const desc = results[index]?.text || "";
      if (!desc) {
        continue;
      }

      if (questionDesc && fuzzMatch(questionDesc, desc)) {
        visionScores[index] += 55;
      }

      if (fuzzMatch(desc, choices[index])) {
        visionScores[index] += 40;
      }

      for (const word of normalizeText(desc).split(/\s+/).filter((token) => token.length > 2)) {
        if (questionNorm.includes(word)) {
          visionScores[index] += 12;
        }
      }
    }

    if (areGenericImageLabels(choices) && questionDesc) {
      for (let index = 0; index < choices.length; index += 1) {
        const desc = results[index]?.text || "";
        if (desc && fuzzMatch(questionDesc, desc)) {
          visionScores[index] += 25;
        }
      }
    }
  }

  const imageDescription = questionVision?.text || choiceDescriptions[0] || "";
  const visionCorpus = [questionVision?.text, ...choiceDescriptions].filter(Boolean).join("\n");

  return {
    visionScores,
    imageDescription,
    visionCorpus,
    usedVision: Boolean(imageDescription || choiceDescriptions.length),
    visionSource: questionVision?.source || "image-search",
  };
}

async function serperLensSearch(imageUrl) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://google.serper.dev/lens", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      url: imageUrl,
      hl: "en",
      gl: "us",
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json().catch(() => null);
  const snippets = [];
  const titles = [];

  if (data?.knowledgeGraph?.title) {
    titles.push(String(data.knowledgeGraph.title));
  }
  if (data?.knowledgeGraph?.subtitle) {
    snippets.push(String(data.knowledgeGraph.subtitle));
  }
  if (data?.knowledgeGraph?.description) {
    snippets.push(String(data.knowledgeGraph.description));
  }

  for (const match of data?.visualMatches || []) {
    if (match?.title) {
      titles.push(String(match.title));
    }
    if (match?.source) {
      snippets.push(String(match.source));
    }
    if (match?.link) {
      snippets.push(String(match.link));
    }
  }

  for (const match of data?.exactMatches || []) {
    if (match?.title) {
      titles.push(String(match.title));
    }
    if (match?.source) {
      snippets.push(String(match.source));
    }
  }

  if (!snippets.length && !titles.length) {
    return null;
  }

  return {
    source: "google-lens",
    snippets,
    titles,
  };
}

async function serperImageSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return null;
  }

  const response = await fetch("https://google.serper.dev/images", {
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
  const snippets = [];
  const titles = [];

  for (const item of data?.images || []) {
    if (item?.title) {
      titles.push(String(item.title));
    }
    if (item?.source) {
      snippets.push(String(item.source));
    }
    if (item?.link) {
      snippets.push(String(item.link));
    }
  }

  if (!snippets.length && !titles.length) {
    return null;
  }

  return {
    source: "google-images",
    snippets,
    titles,
  };
}

async function googleSearchByImage(imageUrl) {
  const url = new URL("https://www.google.com/searchbyimage");
  url.searchParams.set("image_url", imageUrl);
  url.searchParams.set("hl", "en");
  url.searchParams.set("safe", "off");

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

  return {
    source: "google-image-scrape",
    snippets: parsed.snippets,
    titles: parsed.titles,
  };
}

async function runImageSearch(imageUrl, question) {
  const lens = await serperLensSearch(imageUrl);
  if (lens) {
    return lens;
  }

  const reverse = await googleSearchByImage(imageUrl);
  if (reverse) {
    return reverse;
  }

  if (question) {
    return serperImageSearch(`${question} image`);
  }

  return null;
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

async function resolveStormySearch(
  question,
  choices,
  imageUrl = "",
  choiceImages = [],
  inlineImages = null,
) {
  const normalizedQuestion = String(question || "").trim();
  const normalizedImageUrl = normalizeImageUrl(imageUrl);
  const normalizedChoiceImages = (choiceImages || []).map((url) => normalizeImageUrl(url));
  const steps = [];

  if (!normalizedQuestion || choices.length < 2) {
    return {
      choiceIndex: null,
      textAnswer: null,
      confidence: 0,
      source: "invalid-input",
      queries: [],
      snippetCount: 0,
      usedImage: false,
      steps,
      imageDescription: "",
    };
  }

  const questionWithOptions = formatQuestionWithOptions(normalizedQuestion, choices);
  const queries = [normalizedQuestion, questionWithOptions];
  const scores = choices.map(() => 0);
  const usedSources = new Set();
  let snippetCount = 0;
  let usedImage = Boolean(normalizedImageUrl || normalizedChoiceImages.some(Boolean));
  let imageDescription = "";

  const vision = await runVisionAnalysis(
    normalizedQuestion,
    choices,
    normalizedImageUrl,
    normalizedChoiceImages,
    steps,
  );
  imageDescription = vision.imageDescription || "";

  if (vision.visionCorpus) {
    accumulateChoiceScores(
      choices,
      {
        snippets: [vision.visionCorpus],
        titles: imageDescription ? [imageDescription] : [],
      },
      scores,
      3.5,
    );
    usedSources.add(vision.visionSource || "vision");
    snippetCount += 1;
  }

  if (vision.visionScores) {
    for (let index = 0; index < vision.visionScores.length; index += 1) {
      scores[index] += vision.visionScores[index];
    }

    if (areGenericImageLabels(choices)) {
      let bestIndex = -1;
      let bestScore = 0;
      let secondScore = 0;
      for (let index = 0; index < vision.visionScores.length; index += 1) {
        if (vision.visionScores[index] > bestScore) {
          secondScore = bestScore;
          bestScore = vision.visionScores[index];
          bestIndex = index;
        } else if (vision.visionScores[index] > secondScore) {
          secondScore = vision.visionScores[index];
        }
      }

      const margin = bestScore - secondScore;
      if (bestIndex >= 0 && bestScore >= 40 && margin >= 15) {
        steps.push({
          message: `Vision picked "${choices[bestIndex]}" (score ${Math.round(bestScore)}, margin ${Math.round(margin)})`,
          level: "success",
        });
        return {
          choiceIndex: bestIndex,
          textAnswer: choices[bestIndex],
          confidence: bestScore,
          margin,
          source: "vision",
          queries,
          snippetCount,
          usedImage: true,
          steps,
          imageDescription,
        };
      }
    }
  }

  if (normalizedImageUrl) {
    queries.push(`[image] ${normalizedImageUrl}`);
    const imageResult = await runImageSearch(normalizedImageUrl, normalizedQuestion);
    if (imageResult) {
      usedSources.add(imageResult.source);
      snippetCount += imageResult.snippets.length;
      accumulateChoiceScores(choices, imageResult, scores, 4);
      steps.push({
        message: `Reverse image search (${imageResult.source}): ${imageResult.titles.slice(0, 2).join(" · ") || imageResult.snippets[0] || "matches found"}`,
        level: "info",
      });
    } else {
      steps.push({ message: "Reverse image search found nothing", level: "warn" });
    }
  }

  const optionsPreview = choices
    .map((choice) => String(choice || "").trim())
    .filter(Boolean)
    .join(" · ");
  steps.push({
    message: `Search question: "${normalizedQuestion.slice(0, 72)}${normalizedQuestion.length > 72 ? "…" : ""}"`,
    level: "info",
  });
  steps.push({
    message: `Here are the options: ${optionsPreview.slice(0, 120)}${optionsPreview.length > 120 ? "…" : ""}`,
    level: "info",
  });

  const [main, withOptions, ...choiceResults] = await Promise.all([
    runGoogleQuery(normalizedQuestion),
    runGoogleQuery(questionWithOptions),
    ...choices.map(async (choice, index) => {
      const query = `${normalizedQuestion} Here are the options: ${choice}`;
      const result = await runGoogleQuery(query);
      return { index, query, result };
    }),
  ]);

  if (main) {
    usedSources.add(main.source);
    snippetCount += main.snippets.length;
    accumulateChoiceScores(choices, main, scores, 2.5);
    steps.push({
      message: `Question search (${main.source}): ${main.titles[0] || main.snippets[0] || "results"}`,
      level: "info",
    });
  }

  if (withOptions) {
    usedSources.add(withOptions.source);
    snippetCount += withOptions.snippets.length;
    accumulateChoiceScores(choices, withOptions, scores, 3.2);
    steps.push({
      message: `Options search (${withOptions.source}): ${withOptions.titles[0] || withOptions.snippets[0] || "results"}`,
      level: "info",
    });
  }

  for (const { index, query, result } of choiceResults) {
    if (!result) {
      continue;
    }
    queries.push(query);
    usedSources.add(result.source);
    snippetCount += result.snippets.length;
    accumulateChoiceScores(choices, result, scores, 1.4, index);
  }

  if (usedImage) {
    const imageQuery = imageDescription
      ? `${imageDescription} ${normalizedQuestion}`
      : `${normalizedQuestion} identify picture`;
    queries.push(imageQuery);
    const imageText = await serperImageSearch(imageQuery);
    if (imageText) {
      usedSources.add(imageText.source);
      snippetCount += imageText.snippets.length;
      accumulateChoiceScores(choices, imageText, scores, 2);
      steps.push({
        message: `Image text search: ${imageText.titles[0] || imageText.snippets[0] || "results"}`,
        level: "info",
      });
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

  const sortedScores = [...scores].sort((left, right) => right - left);
  const margin = sortedScores[0] - (sortedScores[1] || 0);
  const scoreSummary = choices
    .map((choice, index) => `${choice}=${Math.round(scores[index])}`)
    .join(", ");
  steps.push({ message: `Scores: ${scoreSummary}`, level: "info" });

  const minScore = usedImage || vision.usedVision ? 4 : 8;
  const minMargin = usedImage || vision.usedVision ? 3 : 6;

  const evidenceCorpus = [
    vision.visionCorpus,
    ...choices.map((choice, index) => `${choice}: score ${Math.round(scores[index])}`),
  ].join("\n");

  if (bestIndex < 0 || bestScore < minScore || margin < minMargin) {
    const aiPick = await stormyReasonPick(
      normalizedQuestion,
      choices,
      evidenceCorpus,
      imageDescription || vision.visionCorpus,
    );
    if (aiPick) {
      steps.push({
        message: `Stormy™ AI picked "${choices[aiPick.choiceIndex]}"`,
        level: "success",
      });
      return {
        ...aiPick,
        queries,
        snippetCount,
        usedImage,
        steps,
        imageDescription,
        engine: "stormy-search",
      };
    }

    steps.push({
      message: `Low confidence (best=${Math.round(bestScore)}, margin=${Math.round(margin)}) — guessing`,
      level: "warn",
    });
    return {
      choiceIndex: null,
      textAnswer: null,
      confidence: bestScore,
      margin,
      source: snippetCount > 0 ? "low-confidence" : "no-results",
      queries,
      snippetCount,
      usedImage,
      steps,
      imageDescription,
      engine: "stormy-search",
    };
  }

  const source = usedSources.has("stormy-vision-inline") || usedSources.has("vision")
    ? "vision"
    : usedSources.has("google-lens")
      ? "google-lens"
      : usedSources.has("google-api")
        ? "google-api"
        : usedSources.has("google-serper")
          ? "google-serper"
          : usedSources.has("google-image-scrape")
            ? "google-image-scrape"
            : "google";

  steps.push({
    message: `Stormy™ picked "${choices[bestIndex]}" via ${source} (margin ${Math.round(margin)})`,
    level: "success",
  });

  return {
    choiceIndex: bestIndex,
    textAnswer: choices[bestIndex],
    confidence: bestScore,
    margin,
    source,
    queries,
    snippetCount,
    usedImage,
    steps,
    imageDescription,
    engine: "stormy-search",
  };
}

function parseInlineImages(body) {
  const raw = body?.inlineImages;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const question = raw.question?.data ? raw.question : null;
  const choices = Array.isArray(raw.choices) ? raw.choices.filter((entry) => entry?.data) : [];
  if (!question && !choices.length) {
    return null;
  }
  return { question, choices };
}

async function parseSearchRequest(request) {
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    return {
      question: body.question || "",
      choices: Array.isArray(body.choices) ? body.choices : parseChoices(body.choices),
      imageUrl: body.imageUrl || "",
      choiceImages: Array.isArray(body.choiceImages)
        ? body.choiceImages
        : parseChoiceImages(body.choiceImages),
      inlineImages: parseInlineImages(body),
    };
  }

  const url = new URL(request.url);
  return {
    question: url.searchParams.get("question") || "",
    choices: parseChoices(url.searchParams.get("choices")),
    imageUrl: url.searchParams.get("imageUrl") || "",
    choiceImages: parseChoiceImages(url.searchParams.get("choiceImages")),
    inlineImages: null,
  };
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders() });
}

export async function GET(request) {
  const payload = await parseSearchRequest(request);

  try {
    const result = await resolveStormySearch(
      payload.question,
      payload.choices,
      payload.imageUrl,
      payload.choiceImages,
      payload.inlineImages,
    );
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
        usedImage: Boolean(normalizeImageUrl(payload.imageUrl) || payload.choiceImages.length),
        steps: [{ message: "Stormy™ search error", level: "error" }],
        imageDescription: "",
        engine: "stormy-search",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}

export async function POST(request) {
  return GET(request);
}

export { resolveStormySearch };
