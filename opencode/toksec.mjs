// toksec — OpenCode plugin: live tokens/sec while the model streams.
//
// Install (project):   cp toksec.mjs <project>/.opencode/plugins/toksec.mjs
// Install (global):    edit ~/.config/opencode/opencode.json:
//                        { "plugin": ["/absolute/path/to/toksec.mjs"] }
//
// How it works: subscribes to the server event bus. `message.part.delta` (and
// `message.part.updated` when it carries an incremental `delta`) delivers the
// streamed text; characters are folded into an EMA rate with a
// chars/3.6 ≈ tokens estimate, so it works with any provider. When a
// `step-finish` part lands, the provider-reported output tokens over the
// step's streaming wall-time give the exact per-step average, which is blended
// into the displayed rate.
//
// Display: OpenCode's user-extensible TUI status bar is still experimental, so
// the module publishes to a state file every ~250 ms while streaming — point
// any bar at it, e.g. tmux:
//   set -g status-right '#(jq -r .display /tmp/toksec-opencode.json 2>/dev/null)'
// One toast per finished step shows the settled rate when the TUI client is
// reachable. State file: $TMPDIR/toksec-opencode.json —
//   { "rate": 123, "tokens": 456, "ts": 1690000000000, "display": "⚡ 123 tok/s" }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHARS_PER_TOKEN = 3.6; // provider-independent streamed-text estimate
const EMA_ALPHA = 0.3; // smoothing between consecutive samples
const PUBLISH_INTERVAL_MS = 250; // state-file write throttle
const STATE_FILE = path.join(process.env.TOKSEC_STATE_DIR || os.tmpdir(), "toksec-opencode.json");
const MIN_DT = 0.03; // s
const MAX_DT = 60; // s

const fmt = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`;

export default async function toksec({ client } = {}) {
  // Per-message streaming state (one assistant message at a time is enough for a meter).
  let chars = 0;
  let t0 = null; // first text-delta timestamp
  let lastTs = null; // previous text-delta timestamp
  let estAtLastTs = 0;
  let rate; // EMA tok/s, undefined until the first usable window
  let lastTokens = null; // provider-reported output tokens from the latest step

  let lastPublish = 0;

  const resolveToast = () => {
    const t = client?.tui;
    if (!t) return null;
    if (typeof t.toast?.show === "function") return t.toast.show.bind(t.toast);
    if (typeof t.toast === "function") return t.toast.bind(t);
    return null;
  };

  const publish = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPublish < PUBLISH_INTERVAL_MS) return null;
    lastPublish = now;
    const payload = {
      rate: rate == null ? null : Math.max(1, Math.round(rate)),
      tokens: lastTokens,
      ts: now,
      display: rate == null ? "⚡ — tok/s" : `⚡ ${Math.max(1, Math.round(rate))} tok/s`,
    };
    try {
      const tmp = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, STATE_FILE); // atomic so bar readers never see a torn line
    } catch {}
    return payload;
  };

  const noteText = (len) => {
    const now = Date.now();
    if (t0 === null) {
      t0 = now;
      lastTs = now;
      estAtLastTs = 0;
    }
    chars += len;
    if (lastTs !== null && now > lastTs) {
      const dt = (now - lastTs) / 1000;
      if (dt >= MIN_DT && dt <= MAX_DT) {
        const tokens = chars / CHARS_PER_TOKEN;
        const inst = (tokens - estAtLastTs) / dt;
        rate = rate === undefined ? inst : EMA_ALPHA * inst + (1 - EMA_ALPHA) * rate;
      }
      lastTs = now;
      estAtLastTs = chars / CHARS_PER_TOKEN;
    }
    publish();
  };

  const resetMessage = () => {
    chars = 0;
    t0 = null;
    lastTs = null;
    estAtLastTs = 0;
  };

  return {
    event: async (input) => {
      try {
        const event = input?.event;
        const type = event?.type;
        if (type === "message.part.delta") {
          const p = event.properties ?? {};
          if (p.field === "text" && typeof p.delta === "string" && p.delta.length > 0) {
            noteText(p.delta.length);
          }
          return;
        }

        if (type === "message.part.updated") {
          const part = event.properties?.part;
          if (!part) return;

          if (part.type === "text" && typeof event.properties?.delta === "string") {
            // Incremental full-part delivery (version-dependent): count only the delta.
            if (event.properties.delta.length > 0) noteText(event.properties.delta.length);
            return;
          }

          if (part.type === "step-finish") {
            const out = part.tokens?.output;
            if (typeof out === "number" && t0 !== null) {
              const dur = (Date.now() - t0) / 1000;
              if (dur > MIN_DT) {
                const avg = out / dur; // exact provider-reported average for this step
                rate = EMA_ALPHA * avg + (1 - EMA_ALPHA) * (rate ?? avg);
              }
            }
            if (typeof out === "number") lastTokens = out;
            const payload = publish(true);
            resetMessage();
            if (payload) {
              const toast = resolveToast();
              if (toast) {
                try {
                  await toast({
                    title: "toksec",
                    message: `⚡ ${payload.rate ?? "—"} tok/s · ${fmt(out ?? 0)} out`,
                    variant: "info",
                    duration: 2500,
                  });
                } catch {}
              }
            }
            return;
          }
          return;
        }

        if (type === "session.idle" || type === "session.status") {
          const status = event.properties?.status;
          if (type === "session.status" && status?.type !== "idle") return;
          publish(true);
          resetMessage();
        }
      } catch {}
    },
  };
}