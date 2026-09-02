const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function stormyReasonPick(question, choices, evidenceText, visionSummary = "") {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || !choices?.length || choices.length < 2) {
    return null;
  }

  const numbered = choices.map((choice, index) => `${index + 1}. ${choice}`).join("\n");
  const prompt = `You are Stormy™, a quiz answer engine. Pick the single best multiple-choice answer.

Question: ${question}

Choices:
${numbered}

Web search evidence:
${String(evidenceText || "").slice(0, 5000)}

Vision notes:
${visionSummary || "(none)"}

Reply with ONLY the choice number (1-${choices.length}). No explanation.`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.05, maxOutputTokens: 8 },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  const match = text.match(/\b([1-9]\d*)\b/);
  if (!match) {
    return null;
  }

  const index = Number(match[1]) - 1;
  if (index < 0 || index >= choices.length) {
    return null;
  }

  return {
    choiceIndex: index,
    textAnswer: choices[index],
    source: "stormy-ai",
    confidence: 95,
    margin: 40,
  };
}
