// Minimal client for an OpenAI-compatible chat-completions API. Zero deps
// (uses built-in fetch). Defaults to Groq's free API, but works with any
// OpenAI-compatible provider (OpenAI itself, OpenRouter, etc.) by changing
// LLM_BASE_URL / LLM_MODEL.

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export async function chat({
  apiKey,
  baseUrl = process.env.LLM_BASE_URL || DEFAULT_BASE_URL,
  model = process.env.LLM_MODEL || DEFAULT_MODEL,
  messages,
  temperature = 0.9,
  maxTokens = 500,
}) {
  if (!apiKey) {
    throw new Error("Missing LLM API key. Set LLM_API_KEY (Groq by default).");
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `LLM API error (${res.status}): ${data.error?.message || text}`
    );
  }
  return data.choices[0].message.content.trim();
}
