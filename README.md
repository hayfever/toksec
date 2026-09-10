# ⚡ toksec

Live **tokens/second** meters for coding-agent CLIs. One self-contained file per harness, zero dependencies, no background daemons. Install a file, get a generation-speed readout where you already look.

[![tests](https://github.com/hayfever/toksec/actions/workflows/tests.yml/badge.svg)](https://github.com/hayfever/toksec/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Install

No clone needed.

| Harness | One-liner |
| --- | --- |
| Claude Code | `curl -fsSL https://raw.githubusercontent.com/hayfever/toksec/main/install.sh \| bash -s -- claude` |
| OpenCode | `curl -fsSL https://raw.githubusercontent.com/hayfever/toksec/main/install.sh \| bash -s -- opencode` |
| Pi | `pi install https://github.com/hayfever/toksec` |
| Oh My Pi (OMP) | `omp plugin marketplace add hayfever/toksec && omp plugin install --scope user toksec@toksec` |
| Everything at once | `curl -fsSL https://raw.githubusercontent.com/hayfever/toksec/main/install.sh \| bash -s -- all` |

The installer is conservative: it never overwrites an existing `statusLine` or `opencode.json` plugin entry — it prints the manual snippet instead, and leaves a `.bak` beside any config it edits.

<details>
<summary>Manual install (clone + copy)</summary>

```bash
git clone https://github.com/hayfever/toksec && cd toksec
```

- **Claude Code** — `cp claude/statusline.mjs ~/.claude/toksec.mjs && chmod +x ~/.claude/toksec.mjs`, then add to `~/.claude/settings.json`:
  ```json
  { "statusLine": { "type": "command", "command": "~/.claude/toksec.mjs", "refreshInterval": 2 } }
  ```
- **OpenCode** — `cp opencode/toksec.mjs <project>/.opencode/plugins/toksec.mjs`, or add the absolute path to the `plugin` array in `~/.config/opencode/opencode.json`.
- **Pi** — `cp pi/toksec.ts ~/.pi/agent/extensions/toksec.ts`, then `/reload`.
- **Oh My Pi** — `cp omp/toksec.ts ~/.omp/agent/extensions/toksec.ts`, then `/reload`.

</details>

## Supported harnesses

| Harness | Module | Display surface | Granularity |
| --- | --- | --- | --- |
| Claude Code | `claude/statusline.mjs` | custom status line | per-response average (EMA-smoothed) |
| OpenCode | `opencode/toksec.mjs` | state file for any bar, one toast per step | live estimate → exact at step end |
| Pi | `pi/toksec.ts` | footer status item | live usage deltas → settled average |
| Oh My Pi (OMP) | `omp/toksec.ts` | footer status item | same as Pi |

Point any status bar at OpenCode's published state file (`$TMPDIR/toksec-opencode.json`):

```tmux
set -g status-right '#(jq -r .display /tmp/toksec-opencode.json 2>/dev/null)'
```

## How the rate is computed

| Harness | Live signal | Exact signal | Caveat |
| --- | --- | --- | --- |
| Claude Code | — | response output tokens ÷ its API wall-time (`cost.total_api_duration_ms` delta) | Claude Code never exposes per-token deltas to the status line, so the number refreshes once per response (`refreshInterval` keeps it ticking) |
| OpenCode | `message.part.delta` chars ÷ 3.6 | `step-finish` provider tokens ÷ streaming time | estimate until the first step completes |
| Pi / OMP | `message_update` `usage.output` deltas | `message_end` output ÷ streaming time | char-estimate fallback while a provider reports usage only at stream end |

All modules EMA-smooth consecutive samples and re-baseline on session resets. Both state-file paths honor `TOKSEC_STATE_DIR` (default `$TMPDIR`) for isolation.

## Development

```bash
bun test        # contract tests across the four module families and the installer
```

The harness drives each module through its real integration surface: stdin/JSON for the statusline, synthetic bus events for the OpenCode plugin, a mock `ExtensionAPI` for the pi/OMP extensions, and a sandboxed `$HOME` for `install.sh`. Timing-based assertions use generous ranges by design; everything else is exact. See [CONTRIBUTING.md](CONTRIBUTING.md) to add a harness.

## License

[MIT](LICENSE)