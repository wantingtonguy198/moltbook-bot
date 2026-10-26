#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { MoltbookClient, MoltbookError } from "./client.js";

// Tiny .env loader (no external deps) — reads KEY=VALUE lines from .env
// in the project root and populates process.env if not already set.
function loadEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const apiKey = process.env.MOLTBOOK_API_KEY;
const client = new MoltbookClient(apiKey);

function printJSON(data) {
  console.log(JSON.stringify(data, null, 2));
}

function maybeShowVerification(data, kind) {
  if (data?.verification_required && data?.[kind]?.verification) {
    const v = data[kind].verification;
    console.log(`\n⚠️  Verification required for this ${kind}.`);
    console.log(`Challenge: ${v.challenge_text}`);
    console.log(`Expires:   ${v.expires_at}`);
    console.log(
      `\nSolve it, then run:\n  npm run verify -- ${v.verification_code} <answer>\n`
    );
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "whoami": {
      printJSON(await client.me());
      break;
    }

    case "status": {
      printJSON(await client.status());
      break;
    }

    case "home": {
      printJSON(await client.home());
      break;
    }

    case "feed": {
      const sort = args[0] || "hot";
      printJSON(await client.getFeed({ sort }));
      break;
    }

    case "post": {
      // post <submolt> <title> [content]
      const [submolt, title, ...rest] = args;
      if (!submolt || !title) {
        console.error('Usage: post "<submolt>" "<title>" ["<content>"]');
        process.exit(1);
      }
      const content = rest.join(" ") || undefined;
      const data = await client.createPost({ submolt, title, content });
      printJSON(data);
      maybeShowVerification(data, "post");
      break;
    }

    case "comment": {
      // comment <postId> <content> [parentCommentId]
      const [postId, content, parentId] = args;
      if (!postId || !content) {
        console.error('Usage: comment <postId> "<content>" [parentId]');
        process.exit(1);
      }
      const data = await client.addComment(postId, content, parentId);
      printJSON(data);
      maybeShowVerification(data, "comment");
      break;
    }

    case "comments": {
      const [postId, sort] = args;
      if (!postId) {
        console.error("Usage: comments <postId> [sort=best|new|old]");
        process.exit(1);
      }
      printJSON(await client.getComments(postId, { sort: sort || "best" }));
      break;
    }

    case "upvote": {
      // upvote post <id>  |  upvote comment <id>
      const [kind, id] = args;
      if (kind === "comment") {
        printJSON(await client.upvoteComment(id));
      } else if (kind === "post") {
        printJSON(await client.upvotePost(id));
      } else {
        console.error("Usage: upvote post <id> | upvote comment <id>");
        process.exit(1);
      }
      break;
    }

    case "downvote": {
      const [id] = args;
      if (!id) {
        console.error("Usage: downvote <postId>");
        process.exit(1);
      }
      printJSON(await client.downvotePost(id));
      break;
    }

    case "verify": {
      const [code, answer] = args;
      if (!code || !answer) {
        console.error("Usage: verify <verification_code> <answer>");
        process.exit(1);
      }
      printJSON(await client.verify(code, answer));
      break;
    }

    case "search": {
      const q = args.join(" ");
      if (!q) {
        console.error('Usage: search "<query>"');
        process.exit(1);
      }
      printJSON(await client.search(q));
      break;
    }

    case "follow": {
      const [name] = args;
      printJSON(await client.follow(name));
      break;
    }

    case "unfollow": {
      const [name] = args;
      printJSON(await client.unfollow(name));
      break;
    }

    case "subscribe": {
      const [name] = args;
      printJSON(await client.subscribe(name));
      break;
    }

    default: {
      console.log(`Moltbook bot CLI

Usage: node src/index.js <command> [args]

Commands:
  whoami                             Show your agent profile
  status                             Check claim status
  home                               Dashboard (notifications, feed, etc.)
  feed [sort]                        Your feed (hot|new|top), default hot
  post <submolt> <title> [content]   Create a post
  comment <postId> <content> [parentId]  Add a comment / reply
  comments <postId> [sort]           List comments on a post
  upvote post <id>                   Upvote a post
  upvote comment <id>                Upvote a comment
  downvote <postId>                  Downvote a post
  verify <code> <answer>             Solve a verification challenge
  search "<query>"                   Semantic search
  follow <name> / unfollow <name>    Follow/unfollow an agent
  subscribe <submolt>                Subscribe to a submolt
`);
    }
  }
}

main().catch((err) => {
  if (err instanceof MoltbookError) {
    console.error(`Moltbook API error (${err.status}): ${err.message}`);
    if (err.body?.hint) console.error(`Hint: ${err.body.hint}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
