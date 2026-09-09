// toksec — live tokens/sec meter for Oh My Pi's footer status bar.
//
// Install:   cp toksec.ts ~/.omp/agent/extensions/toksec.ts   # then /reload or restart omp
// Test:      omp -e /path/to/toksec.ts
//
// How the rate is computed, in order of preference:
//   1. Provider usage — `message_update` events carry cumulative usage; each
//      increase in `usage.output` over its timestamp yields a true tok/s
//      sample, EMA-smoothed.
//   2. Char estimate — providers that only report usage at stream completion
//      get a fallback from streamed text deltas (chars / 3.6).
//   3. At `message_end`, the final `usage.output` over streaming wall-time
//      gives the settled average, which becomes the displayed value.
//
// Render: `ctx.ui.setStatus("toksec", "⚡ 87 tok/s · 3.4k out")`, throttled to
// 4 Hz. Cleared on `session_start`.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const STATUS_KEY = "toksec";
const CHARS_PER_TOKEN = 3.6; // fallback estimate when usage lags the stream
const RENDER_EVERY_MS = 250; // status-update throttle
const EMA_ALPHA = 0.35; // smoothing between consecutive samples
const MIN_DT = 0.03; // s — usable sample window
const MAX_DT = 60; // s — gaps longer than this are not a rate

// --- event shape readers (payload shape varies by provider and mode) --------
const readTextDelta = (event: unknown): string | null => {
  if (typeof event !== "object" || event === null || !("assistantMessageEvent" in event)) return null;
  const ame: unknown = event.assistantMessageEvent;
  if (typeof ame !== "object" || ame === null || !("type" in ame) || ame.type !== "text_delta") return null;
  if (!("delta" in ame)) return null;
  const delta: unknown = ame.delta;
  return typeof delta === "string" ? delta : null;
};

const readUsageOutput = (event: unknown): number | null => {
  if (typeof event !== "object" || event === null) return null;
  let usage: unknown;
  if ("usage" in event) {
    usage = event.usage;
  } else if ("message" in event) {
    const msg: unknown = event.message;
    if (typeof msg === "object" && msg !== null && "usage" in msg) usage = msg.usage;
  }
  if (typeof usage !== "object" || usage === null || !("output" in usage)) return null;
  const out: unknown = usage.output;
  return typeof out === "number" && out >= 0 ? out : null;
};

export default function toksec(pi: ExtensionAPI) {
  let chars = 0;
  let lastTextTs: number | null = null;
  let estAtLastTs = 0;
  let usageSeen = false; // a usage delta moved during the current message
  let lastOut: number | null = null;
  let lastOutTs: number | null = null;
  let streamStart: number | null = null;
  let rate: number | undefined;
  let lastRender = 0;
  let lastText = "";

  const fmt = (n: number): string =>
    n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`;

  const render = (ctx: ExtensionContext, text: string, force = false): void => {
    if (text === lastText) return;
    const now = Date.now();
    if (!force && now - lastRender < RENDER_EVERY_MS) return;
    lastRender = now;
    lastText = text;
    try {
      ctx.ui.setStatus(STATUS_KEY, text);
    } catch {}
  };

  const blend = (inst: number): void => {
    rate = rate === undefined ? inst : EMA_ALPHA * inst + (1 - EMA_ALPHA) * rate;
  };

  const noteUsage = (out: number | null, now: number): void => {
    if (out === null) return;
    if (lastOut !== null && out > lastOut) {
      const dt = (now - (lastOutTs ?? now)) / 1000;
      if (dt >= MIN_DT && dt <= MAX_DT) {
        const prev = lastOut;
        blend((out - prev) / dt);
        usageSeen = true;
      }
    } else if (lastOut !== null && out < lastOut) {
      rate = undefined; // new response: usage re-baselined
      usageSeen = false;
    }
    lastOut = out;
    lastOutTs = now;
  };

  const noteText = (delta: string, now: number): void => {
    chars += delta.length;
    if (lastTextTs !== null) {
      const dt = (now - lastTextTs) / 1000;
      if (dt >= MIN_DT && dt <= MAX_DT) {
        const tokens = chars / CHARS_PER_TOKEN;
        const inst = (tokens - estAtLastTs) / dt;
        if (!usageSeen) {
          blend(inst); // char estimate only while usage is not moving
        }
      }
    }
    lastTextTs = now;
    estAtLastTs = chars / CHARS_PER_TOKEN;
  };

  const label = (): string =>
    rate === undefined ? "⚡ — tok/s" : `⚡ ${Math.max(1, Math.round(rate))} tok/s`;

  pi.on("message_update", async (event, ctx) => {
    const now = Date.now();
    const delta = readTextDelta(event);
    if (delta !== null && delta.length > 0) {
      if (streamStart === null) streamStart = now;
      noteText(delta, now);
    }
    noteUsage(readUsageOutput(event), now);

    const suffix = lastOut != null && lastOut > 0 ? ` · ${fmt(lastOut)} out` : "";
    render(ctx, `${label()}${suffix}`);
  });

  pi.on("message_end", async (event, ctx) => {
    const out = readUsageOutput(event);
    if (out !== null && out > 0 && streamStart !== null) {
      const dur = (Date.now() - streamStart) / 1000;
      if (dur >= MIN_DT) blend(out / dur); // settled per-response average
    }
    streamStart = null;
    chars = 0;
    lastTextTs = null;
    estAtLastTs = 0;
    usageSeen = false;
    const suffix = out !== null && out > 0 ? ` · ${fmt(out)} out` : "";
    render(ctx, `${label()}${suffix}`, true);
  });

  pi.on("session_start", async (_event: unknown, ctx) => {
    chars = 0;
    lastTextTs = null;
    estAtLastTs = 0;
    usageSeen = false;
    lastOut = null;
    lastOutTs = null;
    streamStart = null;
    rate = undefined;
    lastRender = 0;
    lastText = "";
    try {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    } catch {}
  });
}