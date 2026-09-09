# ⚡ toksec

Live **tokens/second** meters for coding-agent CLIs. One self-contained file per harness, zero dependencies, no background daemons. Install a file, get a generation-speed readout where you already look.

[![tests](https://github.com/hayfever/toksec/actions/workflows/tests.yml/badge.svg)](https://github.com/hayfever/toksec/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Supported harnesses

| Harness | Module | Display surface | Granularity |
| --- | --- | --- | --- |
| Claude Code | `claude/statusline.mjs` | custom status line | per-response average (EMA-smoothed) |
| OpenCode | `opencode/toksec.mjs` | state file for any bar, one toast per step | live estimate → exact at step end |
| Pi | `pi/toksec.ts` | footer status item | live usage deltas → settled average |
| Oh My Pi (OMP) | `omp/toksec.ts` | footer status item | same as Pi |

## Install

Install steps are also in each module's header comment.

### Claude Code

```bash
mkdir -p ~/.claude
cp claude/statusline.mjs ~/.claude/toksec.mjs && chmod +x ~/.claude/toksec.mjs
```

Merge into `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/toksec.mjs",
    "refreshInterval": 2
  }
}
```

### OpenCode

```bash
cp opencode/toksec.mjs <project>/.opencode/plugins/toksec.mjs
# or globally — ~/.config/opencode/opencode.json:
# { "plugin": ["/absolute/path/to/toksec.mjs"] }
```

Point any status bar at the published state file (`$TMPDIR/toksec-opencode.json`):

```tmux
set -g status-right '#(jq -r .display /tmp/toksec-opencode.json 2>/dev/null)'
```

### Pi

```bash
cp pi/toksec.ts ~/.pi/agent/extensions/toksec.ts   # then /reload or restart
```

### Oh My Pi

```bash
cp omp/toksec.ts ~/.omp/agent/extensions/toksec.ts # then /reload or restart
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
bun test        # 18 contract tests across the three module families
```

The harness drives each module through its real integration surface: stdin/JSON for the statusline, synthetic bus events for the OpenCode plugin, and a mock `ExtensionAPI` for the pi/OMP extensions. Timing-based assertions use generous ranges by design; everything else is exact. See [CONTRIBUTING.md](CONTRIBUTING.md) to add a harness.

## License

[MIT](LICENSE)