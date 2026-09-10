# Changelog

## [0.2.0] - 2026-09-10

### Added
- `install.sh` — one-line curl-pipe installer for Claude Code, OpenCode, pi, and OMP (no clone). Preserves existing status lines and plugin entries; backs up configs before merging.
- Native package installs: repo ships `pi.extensions` and `omp.extensions` manifests plus an OMP marketplace catalog (`omp plugin marketplace add hayfever/toksec`).
- Installer test suite (sandboxed `$HOME`, offline via `TOKSEC_LOCAL_DIR`).

### Changed
- README install section now leads with one-liners.

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-09-09

### Added
- Claude Code statusline module: per-response tokens/sec (`context_window.total_output_tokens` ÷ `cost.total_api_duration_ms` delta), EMA-smoothed, session-keyed state.
- OpenCode plugin: live bus-event meter with chars/3.6 estimate, exact `step-finish` average, atomic state-file publishing, one toast per finished step.
- Pi and Oh My Pi extensions: footer status meter from `message_update` usage deltas, char-estimate fallback, settled per-response average at `message_end`.
- `TOKSEC_STATE_DIR` override on the state-file modules for hermetic runs.
- Test harness (`bun test`) covering all four modules, plus a Node smoke test for the Claude statusline.
- CI workflow (tests on push/PR) and tagged-release workflow.