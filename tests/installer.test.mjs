// Installer contract tests: run install.sh against a sandboxed HOME with
// TOKSEC_LOCAL_DIR pointing at the repo — fully offline, no network in CI.
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.dirname(new URL("../install.sh", import.meta.url).pathname);

const dirs = [];
const sandbox = (overrides = {}) => {
  const home = mkdtempSync(path.join(tmpdir(), "toksec-inst-"));
  dirs.push(home);
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PI_CODING_AGENT_DIR: path.join(home, "omp-agent"),
    TOKSEC_LOCAL_DIR: REPO,
  };
  return { home, env: { ...env, ...overrides } };
};
const run = (target, env) =>
  Bun.spawn(["bash", path.join(REPO, "install.sh"), target], {
    env, stdout: "pipe", stderr: "pipe",
  });
const settings = (home) => JSON.parse(readFileSync(path.join(home, ".claude/settings.json"), "utf8"));
const ocConfig = (home) => JSON.parse(readFileSync(path.join(home, ".config/opencode/opencode.json"), "utf8"));

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("install.sh", () => {
  test("claude: installs script, wires statusLine, is idempotent", async () => {
    const { home, env } = sandbox();
    let proc = run("claude", env);
    expect(await proc.exited).toBe(0);
    const script = path.join(home, ".claude/toksec.mjs");
    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).not.toBe(0);
    const cfg = settings(home);
    expect(cfg.statusLine.command).toBe(script);
    expect(cfg.statusLine.refreshInterval).toBe(2);

    proc = run("claude", env); // rerun must not clobber
    expect(await proc.exited).toBe(0);
    expect(settings(home).statusLine.command).toBe(script);
  });

  test("claude: preserves a pre-existing statusLine", async () => {
    const { home, env } = sandbox();
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".claude/settings.json"), JSON.stringify({ statusLine: { type: "command", command: "/my/own/line.sh" } }));
    const proc = run("claude", env);
    expect(await proc.exited).toBe(0);
    expect(settings(home).statusLine.command).toBe("/my/own/line.sh"); // untouched
    expect(existsSync(path.join(home, ".claude/toksec.mjs"))).toBe(true); // script still installed
  });

  test("opencode: downloads plugin and merges the config array", async () => {
    const { home, env } = sandbox();
    const proc = run("opencode", env);
    expect(await proc.exited).toBe(0);
    const cfg = ocConfig(home);
    expect(cfg.plugin).toHaveLength(1);
    expect(cfg.plugin[0]).toContain("toksec.mjs");
    expect(existsSync(cfg.plugin[0])).toBe(true);
  });

  test("pi: installs into ~/.pi/agent/extensions", async () => {
    const { home, env } = sandbox();
    delete env.PI_CODING_AGENT_DIR; // pi's agent dir is not omp's
    const proc = run("pi", env);
    expect(await proc.exited).toBe(0);
    expect(existsSync(path.join(home, ".pi/agent/extensions/toksec.ts"))).toBe(true);
  });

  test("omp: honors PI_CODING_AGENT_DIR", async () => {
    const { home, env } = sandbox();
    const agentDir = path.join(home, "agent-dir");
    env.PI_CODING_AGENT_DIR = agentDir;
    const proc = run("omp", env);
    expect(await proc.exited).toBe(0);
    expect(existsSync(path.join(agentDir, "extensions/toksec.ts"))).toBe(true);
  });

  test("unknown or missing target exits non-zero with usage", async () => {
    let proc = run("cursor", {});
    expect(await proc.exited).toBe(2);
    proc = Bun.spawn(["bash", path.join(REPO, "install.sh")], { stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(2);
  });
});