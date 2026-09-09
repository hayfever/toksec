// Shared test fixtures for the toksec suites.
// No dependencies: bun:test provides the runner, Bun.spawn drives the CLI contract.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const makeStateDir = () => mkdtemp(path.join(tmpdir(), "toksec-test-"));

// Run a statusline script the way Claude Code does: payload on stdin, one line on stdout.
export async function runClaudeScript(scriptPath, payload, stateDir) {
  const proc = Bun.spawn([process.execPath, scriptPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TOKSEC_STATE_DIR: stateDir },
  });
  proc.stdin.write(payload);
  await proc.stdin.end();
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout: stdout.trim(), exitCode };
}

// Load a pi/OMP extension with a mock ExtensionAPI and expose scripted emit helpers.
export async function driveToksecExtension(extPath) {
  const statuses = [];
  const handlers = new Map();
  const api = {
    on: (name, handler) => handlers.set(name, handler),
    registerTool() {},
    registerCommand() {},
    registerFlag() {},
    registerShortcut() {},
    getFlag() {},
  };
  const { default: factory } = await import(pathToFileURL(extPath).href);
  await factory(api);

  const ctx = {
    hasUI: true,
    cwd: "/tmp",
    ui: { setStatus: (key, value) => statuses.push({ key, value }) },
  };
  const emit = (name, event) => handlers.get(name)(event, ctx);
  const lastStatus = () => statuses.at(-1)?.value;
  const rateOf = (text) => {
    const m = /⚡\s*(\d+) tok\/s/.exec(text ?? "");
    return m ? Number(m[1]) : null;
  };
  return { statuses, emit, lastStatus, rateOf };
}