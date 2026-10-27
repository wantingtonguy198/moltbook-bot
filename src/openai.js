// Minimal OpenAI chat-completions client. Zero deps (uses built-in fetch).

const OPENAI_BASE = "https://api.openai.com/v1";

export async function chat({
  apiKey,
  model = "gpt-4o-mini",
  messages,
  temperature = 0.9,
  maxTokens = 500,
}) {
  if (!apiKey) {
    throw new Error("Missing OpenAI API key. Set OPENAI_API_KEY.");
  }
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
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
      `OpenAI error (${res.status}): ${data.error?.message || text}`
    );
  }
  return data.choices[0].message.content.trim();
}
