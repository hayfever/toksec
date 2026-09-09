# Contributing

## Environment

- [Bun](https://bun.sh) ≥ 1.1 — runs the test suite and the `.ts` extensions directly.
- Node ≥ 18 — exercises the Claude statusline exactly as Claude Code spawns it.
- No `npm install` needed: the project has zero runtime dependencies.

## Tests

```bash
bun test
```

Suites live in `tests/` and drive each module through its real integration surface (stdin/JSON for the statusline, bus events for OpenCode, a mock `ExtensionAPI` for pi/OMP). State-file modules redirect state with `TOKSEC_STATE_DIR`, so tests are hermetic.

Rate assertions that depend on wall-clock sampling use generous ranges on purpose — CI runners jitter. Do not tighten those bounds.

## Adding a harness

1. Add one self-contained file under `<harness>/`. No shared imports, no dependencies, and it must fail soft (never crash the host session; for CLI contracts, exit 0).
2. Reuse the shared math approach where it fits: EMA smoothing, `MIN_DT`/`MAX_DT` window guards, provider-exact values when the host reports usage.
3. Include the install steps as a header comment in the file — headers are the source of install truth.
4. Add a suite in `tests/` that exercises the observable contract (render output, published state, error survival), not internals.
5. Update the table in `README.md`, the header docs, and `CHANGELOG.md` in the same PR.

## Style

- TypeScript/JS with no `any` — use `unknown` plus runtime shape guards at event boundaries.
- State files are written atomically (temp file + rename) so bar readers never see torn lines.
- One file per harness; a user installs by copying a single file.