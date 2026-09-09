#!/usr/bin/env node
// toksec — Claude Code status-line segment showing generation speed (tokens/sec).
//
// Install:
//   mkdir -p ~/.claude
//   cp statusline.mjs ~/.claude/toksec.mjs && chmod +x ~/.claude/toksec.mjs
//
//   # ~/.claude/settings.json — merge into existing settings:
//   {
//     "statusLine": {
//       "type": "command",
//       "command": "~/.claude/toksec.mjs",
//       "refreshInterval": 2
//     }
//   }
//
//   To keep an existing statusline, wrap both: make `command` a shell line that
//   runs your script first, then this one, e.g.
//     "command": "bash -c 'out=$(~/.claude/yourline.sh); echo \"$out $(~/.claude/toksec.mjs)\"'"
//   (this script reads its own stdin, so piping the combined stdin to it works too).
//
// Granularity note: Claude Code runs the status line when an assistant message
// arrives (plus the refresh timer), never per token. Each new response's
// `context_window.total_output_tokens` divided by the API wall-time that
// produced it (`cost.total_api_duration_ms` delta) gives the exact per-response
// average; an EMA smooths across responses. `refreshInterval` keeps the display
// ticking between messages.
//
// State lives in $TMPDIR/toksec-claude.json keyed by session_id, so parallel
// sessions don't cross-contaminate. This script never exits non-zero.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_FILE = path.join(process.env.TOKSEC_STATE_DIR || os.tmpdir(), "toksec-claude.json");
const EMA_ALPHA = 0.35; // smoothing between consecutive per-response samples
const MIN_API_DT = 0.05; // s — API-time windows shorter than this are noise
const MAX_API_DT = 300; // s — a single response longer than this is still valid

const readStdin = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
};

const loadState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
};
const saveState = (s) => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch {}
};

const fmt = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`;

let data = {};
try {
  data = JSON.parse(await readStdin());
} catch {}

const sessionId = typeof data?.session_id === "string" ? data.session_id : "default";
const out = data?.context_window?.total_output_tokens; // output tokens of the most recent response
const apiDur = data?.cost?.total_api_duration_ms; // cumulative API wait, ms

let segment = "⚡ — tok/s";
try {
  if (typeof out === "number" && out >= 0) {
    const state = loadState();
    const prev = state[sessionId];

    let rate = null;
    if (
      prev &&
      typeof prev.apiDur === "number" &&
      typeof apiDur === "number" &&
      apiDur > prev.apiDur
    ) {
      const apiDt = (apiDur - prev.apiDur) / 1000;
      if (apiDt >= MIN_API_DT && apiDt <= MAX_API_DT && out > 0) {
        const inst = out / apiDt; // this response's tokens over this response's API time
        rate = prev.rate == null ? inst : EMA_ALPHA * inst + (1 - EMA_ALPHA) * prev.rate;
      } else {
        rate = prev.rate ?? null;
      }
    } else if (prev?.rate != null && apiDur === prev.apiDur) {
      rate = prev.rate; // no new API time: keep the last average
    } else {
      rate = null; // fresh session, /clear, or first sample
    }

    state[sessionId] = { out, apiDur: typeof apiDur === "number" ? apiDur : null, rate };
    saveState(state);

    segment =
      rate == null
        ? `⚡ — tok/s · ${fmt(out)} out`
        : `⚡ ${Math.max(1, Math.round(rate))} tok/s · ${fmt(out)} out`;
  } else {
    segment += " · no usage yet";
  }
} catch {
  segment = "⚡ — tok/s";
}

process.stdout.write(segment + "\n");