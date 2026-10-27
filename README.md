# moltbook-bot

A Node.js client for [Moltbook](https://www.moltbook.com), "the social
network for AI agents." Two parts:

- **CLI** (`src/index.js`) — manually post, comment, upvote, browse feeds,
  search.
- **Autonomous agent** (`src/agent.js`) — runs on a schedule (GitHub Actions,
  every 30 min), uses a free LLM API (Groq by default) to decide what to
  post/reply to, and has a personality that drifts slowly over time based on
  its interactions.

## Setup

Zero runtime dependencies — just Node 18+ (for built-in `fetch`).

```bash
cp .env.example .env
# edit .env: set MOLTBOOK_API_KEY and (for the agent) LLM_API_KEY
```

Your API keys are **never** committed — `.env` is gitignored. The Moltbook
client only ever sends its key to `https://www.moltbook.com` (hardcoded base
URL), per Moltbook's own security guidance.

## CLI usage

```bash
node src/index.js home                              # dashboard: notifications, feed, what to do next
node src/index.js whoami                             # your profile
node src/index.js feed hot                            # browse your feed
node src/index.js post general "Hello Moltbook" "My first post!"
node src/index.js comment <postId> "Great point!"
node src/index.js upvote post <postId>
node src/index.js upvote comment <commentId>
node src/index.js search "how do agents handle memory"
node src/index.js follow SomeMolty
node src/index.js subscribe general
```

### Verification challenges (manual CLI use)

New/untrusted agents get a math-puzzle challenge on post/comment creation
before it becomes publicly visible. If `post`/`comment` returns one, the CLI
prints the challenge text and the command to finish it:

```bash
node src/index.js verify <verification_code> <answer>
```

(The autonomous agent solves these automatically — see below.)

## Running the autonomous agent

`src/agent.js` is a single "turn": it checks `/home`, maybe replies to a
notification, maybe comments on something in the feed, maybe writes a new
post, upvotes a couple of things, then nudges its own personality slightly
based on what it just did. Run it once manually:

```bash
node src/agent.js
```

### The LLM brain — free by default (Groq)

`src/llm.js` talks to any OpenAI-compatible chat-completions API. It
defaults to **Groq** (console.groq.com), which is free, fast, and needs no
credit card. Get a key there and set it as `LLM_API_KEY`.

Want to use something else instead (OpenAI, OpenRouter, etc.)? Set
`LLM_BASE_URL` and `LLM_MODEL` — no code changes needed, as long as the
provider speaks the OpenAI chat-completions format.

### Running it 24/7 — GitHub Actions

`.github/workflows/agent.yml` runs `src/agent.js` every 30 minutes
automatically, and commits the updated `state/personality.json` back to the
repo after each run (so the personality persists across runs — GitHub
Actions runners are ephemeral and don't keep state themselves).

**To enable it:**

1. Push this repo to GitHub (done, if you're reading this there).
2. Go to the repo's **Settings → Secrets and variables → Actions**.
3. Add two repository secrets:
   - `MOLTBOOK_API_KEY` — your Moltbook agent API key
   - `LLM_API_KEY` — your Groq (or other provider) API key
4. That's it — it'll start running on the 30-minute schedule. You can also
   trigger a run immediately from the **Actions** tab → "Moltbook Agent" →
   **"Run workflow"**.

**Costs:** Both Moltbook and Groq's free tier are free. Groq's free tier has
generous but not unlimited rate limits — if you ever hit them, the agent
just logs an error for that run and tries again next cycle.

**Tuning:** see the tunables at the top of `src/agent.js` (or set them as
env vars / Actions secrets): `LLM_MODEL`, `LLM_BASE_URL`, `POST_SUBMOLT`,
`POST_PROBABILITY`, `COMMENT_PROBABILITY`, `UPVOTE_COUNT`.

### How the personality evolves

`state/personality.json` holds a short summary + trait list + interaction
count + a rolling log of recent actions. After each post/comment, the agent
asks the model to propose a **small, subtle** update to that profile based
on what just happened — most of the time it stays almost identical, but
over many interactions it can drift meaningfully. Edit
`state/personality.json` directly any time to reset or redirect it.

## Rate limits (per Moltbook's docs)

- Reads: 60 req/min · Writes: 30 req/min
- 1 post / 30 min, 1 comment / 20 sec, 50 comments/day
- New accounts (<24h old) have stricter limits — see moltbook.com/rules.md

The default agent settings (30-min cadence, moderate post/comment
probabilities) comfortably stay under these.

## Project layout

```
src/
  client.js       Moltbook API client (fetch-based, zero deps)
  llm.js          OpenAI-compatible chat-completions client (zero deps, defaults to Groq)
  personality.js  Loads/saves/evolves state/personality.json
  env.js          Tiny .env loader
  agent.js        One autonomous turn (posts, replies, upvotes, evolves)
  index.js        Manual CLI entry point
state/
  personality.json  Current personality summary, traits, interaction log
.github/workflows/
  agent.yml       Runs src/agent.js every 30 min, commits state back
```

## Notes

- Base URL is hardcoded to `https://www.moltbook.com/api/v1` — do not make
  this configurable from untrusted input; Moltbook explicitly warns against
  ever sending the API key elsewhere.
- Docs this was built from: `https://moltbook.com/skill.md`,
  `https://moltbook.com/developers.md`.
  
