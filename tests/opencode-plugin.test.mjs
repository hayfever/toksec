// OpenCode plugin contract tests: synthetic bus events in, state file + toasts out.
// One plugin instance family per suite; TOKSEC_STATE_DIR is fixed before first
// import so every test in this file shares one hermetic state file.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLUGIN = new URL("../opencode/toksec.mjs", import.meta.url).pathname;
let stateDir;

beforeAll(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), "toksec-oc-test-"));
  process.env.TOKSEC_STATE_DIR = stateDir;
});
afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
  delete process.env.TOKSEC_STATE_DIR;
});

const statePath = () => path.join(stateDir, "toksec-opencode.json");
const readState = () => JSON.parse(readFileSync(statePath(), "utf8"));

async function loadPlugin(toasts) {
  const { default: init } = await import(pathToFileURL(PLUGIN).href);
  const hooks = await init({
    client: { tui: { toast: { show: async (props) => toasts.push(props) } } },
  });
  return (type, properties) => hooks.event({ event: { type, properties } });
}

describe("opencode toksec plugin", () => {
  test("streams a live rate, settles exact tokens, toasts once per step", async () => {
    const toasts = [];
    const emit = await loadPlugin(toasts);

    // 2880 chars ≈ 800 estimated tokens across ~500 ms
    await emit("message.part.delta", { field: "text", messageID: "m1", partID: "p1", delta: "a".repeat(720) });
    await Bun.sleep(500);
    await emit("message.part.delta", { field: "text", messageID: "m1", partID: "p1", delta: "b".repeat(2160) });

    // step completes with provider-reported tokens: 640 output over ~0.5 s
    await emit("message.part.updated", {
      part: {
        messageID: "m1",
        type: "step-finish",
        tokens: { input: 120, output: 640, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    });

    expect(existsSync(statePath())).toBe(true);
    const state = readState();
    expect(state.rate).toBeGreaterThanOrEqual(700);
    expect(state.rate).toBeLessThanOrEqual(2000);
    expect(state.tokens).toBe(640);
    expect(state.display).toMatch(/tok\/s/);

    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toContain("tok/s");
  });

  test("idle republishes without losing the settled value", async () => {
    const toasts = [];
    const emit = await loadPlugin(toasts);
    await emit("message.part.delta", { field: "text", partID: "p2", messageID: "m2", delta: "z".repeat(720) });
    await Bun.sleep(400);
    await emit("message.part.updated", { part: { messageID: "m2", type: "step-finish", tokens: { output: 100 } } });
    const settled = readState();
    await emit("session.idle", { sessionID: "x" });
    await emit("session.status", { sessionID: "x", status: { type: "idle" } });
    const afterIdle = readState();
    expect(afterIdle.rate).toBe(settled.rate);
    expect(afterIdle.tokens).toBe(100);
  });

  test("non-text deltas never publish, malformed events never throw", async () => {
    const toasts = [];
    const emit = await loadPlugin(toasts);
    rmSync(statePath(), { force: true }); // this scenario must publish nothing
    await emit("message.part.delta", { field: "reasoning", partID: "p3", messageID: "m3", delta: "thinking..." });
    await emit("message.part.updated", { part: undefined });
    await emit("session.status", { sessionID: "x", status: { type: "busy" } });
    expect(existsSync(statePath())).toBe(false);
  });
});