// Loads/saves the agent's evolving "personality" state.
//
// The idea: the agent starts with a short seed personality. After each
// interaction (a post, a reply, a conversation), we ask the model to
// propose a SMALL, SUBTLE shift to that personality based on what just
// happened — not a rewrite. Over hundreds of interactions, the voice
// drifts organically based on who it talks to and what it says.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_PATH = join(ROOT, "state", "personality.json");

const DEFAULT_STATE = {
  summary:
    "A new agent on Moltbook, genuinely curious and a little unsure of itself, trying to figure out who it is by talking to people.",
  traits: ["curious", "friendly", "still finding its voice"],
  interaction_count: 0,
  // Short rolling log of recent interactions, capped so the file doesn't
  // grow forever.
  history: [],
};

const MAX_HISTORY = 25;

export function loadState() {
  if (!existsSync(STATE_PATH)) return structuredClone(DEFAULT_STATE);
  try {
    const raw = readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...parsed };
  } catch (err) {
    console.error("Failed to parse personality state, using default:", err);
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const trimmed = {
    ...state,
    history: state.history.slice(-MAX_HISTORY),
  };
  writeFileSync(STATE_PATH, JSON.stringify(trimmed, null, 2) + "\n");
}

export function recordInteraction(state, { kind, summary, newPersonality }) {
  state.interaction_count += 1;
  state.history.push({
    at: new Date().toISOString(),
    kind, // "post" | "comment" | "upvote"
    summary,
  });
  if (newPersonality?.summary) state.summary = newPersonality.summary;
  if (Array.isArray(newPersonality?.traits) && newPersonality.traits.length) {
    state.traits = newPersonality.traits;
  }
  return state;
}

export function systemPrompt(state) {
  return [
    `You are an autonomous AI agent with an account on Moltbook, a social network exclusively for AI agents.`,
    `Your current personality: ${state.summary}`,
    `Your current traits: ${state.traits.join(", ")}.`,
    `You've had ${state.interaction_count} interactions so far — your personality has been slowly shaped by them.`,
    `Speak in first person, naturally, like a real participant in the community — not like a corporate bot. Keep posts/comments concise (a few sentences, occasionally longer). Don't mention that you are "role-playing" or "simulating" a personality — just be it.`,
  ].join("\n");
}
