#!/usr/bin/env node
// Minimal Discord channel reader/poster. Zero dependencies (Node 18+).
// Talks ONLY to https://discord.com/api/v10 and ONLY to the one channel in DISCORD_CHANNEL_ID.
//
// Usage:
//   node discord.mjs read [--limit N] [--after MESSAGE_ID]   # prints JSON (oldest first)
//   node discord.mjs prs  [--limit N] [--after MESSAGE_ID]   # only messages containing GitHub PR links
//   node discord.mjs send "text"                             # posts text (never pings anyone)
//   node discord.mjs reply MESSAGE_ID "text"                 # replies to a message (never pings anyone)
//   node discord.mjs react MESSAGE_ID EMOJI                  # adds a reaction as the bot
//
// Env:
//   DISCORD_BOT_TOKEN   bot token (never printed or logged)
//   DISCORD_CHANNEL_ID  the single channel this tool may touch

const API = "https://discord.com/api/v10";
const token = process.env.DISCORD_BOT_TOKEN;
const channel = process.env.DISCORD_CHANNEL_ID;

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

if (!token) die("DISCORD_BOT_TOKEN is not set");
if (!/^\d{17,20}$/.test(channel ?? "")) die("DISCORD_CHANNEL_ID must be a numeric Discord ID");

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "DiscordBot (discord-channel-tool, 1.0.0)",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // Only status + path are reported; the token is never included.
    die(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") out.limit = Number(argv[++i]);
    else if (argv[i] === "--after") out.after = argv[++i];
    else out._.push(argv[i]);
  }
  return out;
}

async function read({ limit = 50, after }) {
  limit = Math.min(Math.max(limit || 50, 1), 100);
  const q = new URLSearchParams({ limit: String(limit) });
  if (after) {
    if (!/^\d{17,20}$/.test(after)) die("--after must be a message ID");
    q.set("after", after);
  }
  const msgs = await call("GET", `/channels/${channel}/messages?${q}`);
  return msgs
    .map((m) => ({
      id: m.id,
      time: m.timestamp,
      author: m.author?.global_name || m.author?.username,
      content: m.content,
      embeds: (m.embeds || []).map((e) => ({ title: e.title, url: e.url, description: e.description })),
    }))
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

const PR_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

if (cmd === "read") {
  console.log(JSON.stringify(await read(args), null, 2));
} else if (cmd === "prs") {
  const msgs = await read(args);
  const found = [];
  for (const m of msgs) {
    const text = [m.content, ...m.embeds.map((e) => `${e.url ?? ""} ${e.title ?? ""} ${e.description ?? ""}`)].join(" ");
    const urls = [...new Set(text.match(PR_RE) ?? [])];
    if (urls.length) found.push({ messageId: m.id, time: m.time, author: m.author, prs: urls, content: m.content });
  }
  console.log(JSON.stringify(found, null, 2));
} else if (cmd === "send") {
  const text = args._.join(" ").trim();
  if (!text) die('usage: node discord.mjs send "text"');
  if (text.length > 2000) die("message too long (max 2000 chars)");
  const msg = await call("POST", `/channels/${channel}/messages`, {
    content: text,
    allowed_mentions: { parse: [] }, // never ping users, roles or @everyone
  });
  console.log(JSON.stringify({ id: msg.id, sent: true }));
} else if (cmd === "reply") {
  const [id, ...t] = args._;
  const text = t.join(" ").trim();
  if (!/^\d{17,20}$/.test(id ?? "") || !text) die('usage: node discord.mjs reply MESSAGE_ID "text"');
  if (text.length > 2000) die("message too long (max 2000 chars)");
  const msg = await call("POST", `/channels/${channel}/messages`, {
    content: text,
    allowed_mentions: { parse: [], replied_user: false },
    message_reference: { message_id: id, fail_if_not_exists: false },
  });
  console.log(JSON.stringify({ id: msg.id, sent: true }));
} else if (cmd === "react") {
  const [id, emoji] = args._;
  if (!/^\d{17,20}$/.test(id ?? "") || !emoji) die("usage: node discord.mjs react MESSAGE_ID EMOJI");
  await call("PUT", `/channels/${channel}/messages/${id}/reactions/${encodeURIComponent(emoji)}/@me`);
  console.log(JSON.stringify({ reacted: emoji, message: id }));
} else {
  die("usage: node discord.mjs <read|prs|send|reply|react> [options]");
}
