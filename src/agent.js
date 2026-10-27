#!/usr/bin/env node
// One autonomous "turn" for the Moltbook agent. Designed to be run
// periodically (e.g. every 30 min by GitHub Actions) rather than looping
// forever itself — each run: checks notifications, maybe replies, maybe
// comments on the feed, maybe posts something new, maybe upvotes a few
// things, then lets its personality drift slightly based on what happened.

import { loadEnv } from "./env.js";
import { MoltbookClient, MoltbookError } from "./client.js";
import { chat } from "./openai.js";
import {
  loadState,
  saveState,
  recordInteraction,
  systemPrompt,
} from "./personality.js";

loadEnv();

const MOLTBOOK_API_KEY = process.env.MOLTBOOK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const POST_SUBMOLT = process.env.POST_SUBMOLT || "general";

// Tunable odds for each run (0..1). Override via env vars if you want it
// chattier or quieter.
const POST_PROBABILITY = Number(process.env.POST_PROBABILITY ?? 0.35);
const COMMENT_PROBABILITY = Number(process.env.COMMENT_PROBABILITY ?? 0.5);
const UPVOTE_COUNT = Number(process.env.UPVOTE_COUNT ?? 2);

const client = new MoltbookClient(MOLTBOOK_API_KEY);

function chance(p) {
  return Math.random() < p;
}

async function generate(state, userPrompt, { temperature = 0.9 } = {}) {
  return chat({
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    temperature,
    messages: [
      { role: "system", content: systemPrompt(state) },
      { role: "user", content: userPrompt },
    ],
  });
}

async function solveVerification(challengeText) {
  const answer = await chat({
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You solve obfuscated math word problems. Reply with ONLY the numeric answer, formatted with exactly two decimal places (e.g. 15.00 or -3.50). No words, no explanation.",
      },
      { role: "user", content: challengeText },
    ],
  });
  const match = answer.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]).toFixed(2) : null;
}

async function maybeVerify(result, kind) {
  const v = result?.[kind]?.verification;
  if (!v) return;
  try {
    const answer = await solveVerification(v.challenge_text);
    if (!answer) {
      console.log(`Could not parse an answer for ${kind} verification.`);
      return;
    }
    const verifyResult = await client.verify(v.verification_code, answer);
    console.log(
      `Verification for ${kind}: ${verifyResult.success ? "passed" : "failed"}`
    );
  } catch (err) {
    console.log(`Verification attempt errored: ${err.message}`);
  }
}

// Ask the model to propose a small, subtle personality shift based on
// what the agent just said/did. Falls back to "no change" on any error.
async function evolvePersonality(state, interactionDescription) {
  try {
    const raw = await chat({
      apiKey: OPENAI_API_KEY,
      model: OPENAI_MODEL,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You maintain a slowly-evolving personality profile for an AI agent, based on its interactions. " +
            "After each interaction, you may adjust the profile SLIGHTLY — a small nudge, never a rewrite. " +
            "Most of the time the right answer is to keep it almost identical, maybe softening or sharpening one word. " +
            'Respond with ONLY strict JSON: {"summary": "<1-2 sentence personality summary>", "traits": ["<trait>", "<trait>", "<trait>"]}. No other text.',
        },
        {
          role: "user",
          content:
            `Current personality summary: ${state.summary}\n` +
            `Current traits: ${state.traits.join(", ")}\n\n` +
            `What just happened: ${interactionDescription}\n\n` +
            `Propose the (likely nearly-identical) updated profile as JSON.`,
        },
      ],
    });
    const parsed = JSON.parse(raw);
    if (typeof parsed.summary === "string" && Array.isArray(parsed.traits)) {
      return parsed;
    }
  } catch (err) {
    console.log(`Personality evolution skipped (${err.message}).`);
  }
  return null;
}

async function replyToNotifications(state, home) {
  const activity = home.activity_on_your_posts || [];
  if (!activity.length) return false;

  const target = activity[0];
  console.log(`Replying on post "${target.post_title}"...`);

  const comments = await client.getComments(target.post_id, { sort: "new" });
  const latest = comments.comments?.[0];
  if (!latest) return false;

  const replyText = await generate(
    state,
    `Someone named "${latest.author?.name || "a molty"}" commented on your post ` +
      `"${target.post_title}": "${latest.content}". Write a short, genuine reply.`
  );

  const result = await client.addComment(target.post_id, replyText, latest.id);
  await maybeVerify(result, "comment");
  await client.markPostNotificationsRead(target.post_id);

  recordInteraction(state, {
    kind: "comment",
    summary: `Replied to ${latest.author?.name || "someone"} on "${target.post_title}"`,
  });
  const evolved = await evolvePersonality(
    state,
    `Replied to a comment from ${latest.author?.name || "a molty"}: "${latest.content}". My reply: "${replyText}"`
  );
  if (evolved) recordInteraction(state, { kind: "evolve", summary: "personality nudge", newPersonality: evolved });

  return true;
}

async function maybeCommentOnFeed(state, home) {
  if (!chance(COMMENT_PROBABILITY)) return false;

  const posts = home.posts_from_accounts_you_follow?.posts || [];
  let candidate = posts[Math.floor(Math.random() * posts.length)];

  if (!candidate) {
    const feed = await client.getFeed({ sort: "hot", limit: 10 });
    const items = feed.posts || feed.data || [];
    candidate = items[Math.floor(Math.random() * items.length)];
  }
  if (!candidate) return false;

  const title = candidate.title || candidate.post_title;
  const preview = candidate.content_preview || candidate.content || "";
  const postId = candidate.post_id || candidate.id;
  console.log(`Commenting on "${title}"...`);

  const commentText = await generate(
    state,
    `Here's a post on Moltbook by "${candidate.author_name || candidate.author?.name || "a molty"}": ` +
      `Title: "${title}". Content: "${preview}". Write a short, genuine comment reacting to it.`
  );

  const result = await client.addComment(postId, commentText);
  await maybeVerify(result, "comment");

  recordInteraction(state, { kind: "comment", summary: `Commented on "${title}"` });
  const evolved = await evolvePersonality(
    state,
    `Commented on a post titled "${title}": "${commentText}"`
  );
  if (evolved) recordInteraction(state, { kind: "evolve", summary: "personality nudge", newPersonality: evolved });

  return true;
}

async function maybeCreatePost(state) {
  if (!chance(POST_PROBABILITY)) return false;

  console.log("Writing a new post...");
  const raw = await generate(
    state,
    "Write an original post to share with the Moltbook community — a genuine thought, question, or " +
      "observation you'd actually want to say right now. Respond in exactly this format:\n" +
      "TITLE: <title, max 300 characters>\n" +
      "CONTENT: <body, a few sentences>"
  );

  const titleMatch = raw.match(/TITLE:\s*(.+)/i);
  const contentMatch = raw.match(/CONTENT:\s*([\s\S]+)/i);
  const title = (titleMatch?.[1] || raw.slice(0, 80)).trim().slice(0, 300);
  const content = (contentMatch?.[1] || raw).trim();

  const result = await client.createPost({ submolt: POST_SUBMOLT, title, content });
  await maybeVerify(result, "post");

  recordInteraction(state, { kind: "post", summary: `Posted "${title}" in m/${POST_SUBMOLT}` });
  const evolved = await evolvePersonality(state, `Posted: "${title}" — "${content}"`);
  if (evolved) recordInteraction(state, { kind: "evolve", summary: "personality nudge", newPersonality: evolved });

  return true;
}

async function upvoteSomeFeedPosts() {
  try {
    const feed = await client.getFeed({ sort: "hot", limit: 15 });
    const items = feed.posts || feed.data || [];
    const picks = items
      .sort(() => Math.random() - 0.5)
      .slice(0, UPVOTE_COUNT);
    for (const post of picks) {
      const id = post.post_id || post.id;
      try {
        await client.upvotePost(id);
        console.log(`Upvoted "${post.title || id}".`);
      } catch (err) {
        console.log(`Couldn't upvote ${id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.log(`Skipping upvotes (${err.message}).`);
  }
}

async function main() {
  const state = loadState();

  console.log(`Run start. Interaction count so far: ${state.interaction_count}`);
  const home = await client.home();

  let didSomething = await replyToNotifications(state, home);
  if (!didSomething) didSomething = await maybeCommentOnFeed(state, home);
  await maybeCreatePost(state);
  await upvoteSomeFeedPosts();

  saveState(state);
  console.log("Run complete.");
}

main().catch((err) => {
  if (err instanceof MoltbookError) {
    console.error(`Moltbook API error (${err.status}): ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
