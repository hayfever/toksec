// Claude Code statusline contract tests: stdin payload in, one segment out.
// Rate math is API-duration based, so every expectation here is deterministic.
import { describe, test, expect, beforeAll } from "bun:test";
import { runClaudeScript, makeStateDir } from "./helpers.mjs";

const SCRIPT = new URL("../claude/statusline.mjs", import.meta.url).pathname;
const line = (session, out, apiMs) => {
  const p = { session_id: session };
  if (out !== undefined) p.context_window = { total_output_tokens: out };
  if (apiMs !== undefined) p.cost = { total_api_duration_ms: apiMs };
  return JSON.stringify(p);
};
const { apiMs } = {}; // placeholder to avoid lint confusion (unused)
let stateDir;

beforeAll(async () => {
  stateDir = await makeStateDir();
});
describe("claude statusline", () => {
  test("never exits non-zero and always prints a segment", async () => {
    const r = await runClaudeScript(SCRIPT, "not json at all", stateDir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("⚡");
  });

  test("missing usage reports it", async () => {
    const r = await runClaudeScript(SCRIPT, JSON.stringify({ session_id: "fresh" }), stateDir);
    expect(r.stdout).toBe("⚡ — tok/s · no usage yet");
  });

  test("fresh session baselines without a rate", async () => {
    const r = await runClaudeScript(SCRIPT, line("s1", 1200, 12000), stateDir);
    expect(r.stdout).toBe("⚡ — tok/s · 1.2k out");
  });

  test("unchanged API time keeps the previous state", async () => {
    const r = await runClaudeScript(SCRIPT, line("s1", 1200, 12000), stateDir);
    expect(r.stdout).toBe("⚡ — tok/s · 1.2k out");
  });

  test("computes the exact per-response average", async () => {
    // out 900 over an apiDt of 4.25 s → 211.76 tok/s
    const r = await runClaudeScript(SCRIPT, line("s1", 900, 16250), stateDir);
    expect(r.stdout).toBe("⚡ 212 tok/s · 900 out");
  });

  test("EMA-smooths across responses", async () => {
    // inst 800/2s = 400; EMA = 0.35*400 + 0.65*211.76 = 277.65 → 278
    const r = await runClaudeScript(SCRIPT, line("s1", 800, 18250), stateDir);
    expect(r.stdout).toBe("⚡ 278 tok/s · 800 out");
  });

  test("parallel sessions do not cross-contaminate", async () => {
    const r = await runClaudeScript(SCRIPT, line("s2", 5000, 2000), stateDir);
    expect(r.stdout).toBe("⚡ — tok/s · 5.0k out");
    // s1 is untouched
    const again = await runClaudeScript(SCRIPT, line("s1", 800, 18250), stateDir);
    expect(again.stdout).toBe("⚡ 278 tok/s · 800 out");
  });
});