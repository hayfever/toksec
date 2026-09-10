#!/usr/bin/env bash
# toksec installer — no clone required.
#
#   curl -fsSL https://raw.githubusercontent.com/hayfever/toksec/main/install.sh | bash -s -- <target>
#
# Targets: claude | opencode | pi | omp | all
#
# TOKSEC_LOCAL_DIR (optional): copy files from a local checkout instead of
# downloading — used by the test suite and for air-gapped installs.
set -u

RAW="https://raw.githubusercontent.com/hayfever/toksec/main"
LOCAL_DIR="${TOKSEC_LOCAL_DIR:-}"
NAME="toksec"

fetch() { # <repo-relative-file> <dest>
  if [ -n "$LOCAL_DIR" ]; then
    cp "$LOCAL_DIR/$1" "$2" || return 1
  else
    curl -fsSL "$RAW/$1" -o "$2" || return 1
  fi
}

die() { echo "error: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: install.sh <target>

Targets:
  claude    Claude Code status-line segment (~/.claude/toksec.mjs)
  opencode  OpenCode plugin (~/.config/opencode/toksec.mjs + opencode.json entry)
  pi        pi extension (~/.pi/agent/extensions/toksec.ts)
  omp       Oh My Pi extension (~/.omp/agent/extensions/toksec.ts)
  all       all of the above

Native one-liners (preferred where available):
  pi install https://github.com/hayfever/toksec
  omp plugin marketplace add hayfever/toksec && omp plugin install --scope user toksec@toksec
EOF
}

# run_node_merge <node-script> <config-file> <toksec-script-path>
# The node script edits the config in place and prints progress to stderr.
# Exit codes: 0 = updated, 4 = already configured, 3 = manual merge needed.
run_node_merge() {
  command -v node >/dev/null 2>&1 || return 2
  node "$@"
}

# --- claude -----------------------------------------------------------------
install_claude() {
  local script="$HOME/.claude/${NAME}.mjs"
  local settings="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude"
  fetch "claude/statusline.mjs" "$script" || die "download failed"
  chmod +x "$script"

  local mergejs
  mergejs="$(mktemp)"
  cat >"$mergejs" <<'EOF'
// Reads settings.json, wires statusLine if safe, writes in place.
const fs = require("node:fs");
const [path, script] = process.argv.slice(2);
const entry = { type: "command", command: script, refreshInterval: 2 };
let cfg = {};
if (fs.existsSync(path)) {
  try {
    cfg = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    console.error("settings.json is not parseable JSON (comments?) — merge manually:");
    console.error(JSON.stringify(entry));
    process.exit(3);
  }
}
if (cfg.statusLine) {
  if (String(cfg.statusLine.command).includes("toksec")) {
    console.error("statusLine already points at toksec — leaving it untouched.");
    process.exit(4);
  }
  console.error("settings.json already defines a statusLine; add this beside yours:");
  console.error(JSON.stringify(entry));
  process.exit(3);
}
if (fs.existsSync(path)) fs.copyFileSync(path, path + ".bak");
cfg.statusLine = entry;
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
EOF

  run_node_merge "$mergejs" "$settings" "$script"
  case $? in
    0) echo "installed: $script (statusLine wired into $settings)" ;;
    4) echo "already installed: $script" ;;
    *) echo "installed: $script"
       echo "manual step: add to $settings ->"
       echo '  { "statusLine": { "type": "command", "command": "'"$script"'", "refreshInterval": 2 } }' ;;
  esac
  rm -f "$mergejs"
}

# --- opencode ---------------------------------------------------------------
install_opencode() {
  local cfg_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  local script="$cfg_dir/${NAME}.mjs"
  local settings="$cfg_dir/opencode.json"
  mkdir -p "$cfg_dir"
  fetch "opencode/toksec.mjs" "$script" || die "download failed"

  local mergejs
  mergejs="$(mktemp)"
  cat >"$mergejs" <<'EOF'
// Reads opencode.json, appends toksec.mjs to the "plugin" array, writes in place.
const fs = require("node:fs");
const [path, script] = process.argv.slice(2);
let cfg = {};
if (fs.existsSync(path)) {
  try {
    cfg = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    console.error("opencode.json is not parseable JSON (comments?) — add manually:");
    console.error(JSON.stringify({ plugin: [script] }));
    process.exit(3);
  }
}
cfg.plugin = Array.isArray(cfg.plugin) ? cfg.plugin : [];
if (cfg.plugin.includes(script)) {
  console.error("plugin entry already present — leaving it untouched.");
  process.exit(4);
}
if (fs.existsSync(path)) fs.copyFileSync(path, path + ".bak");
cfg.plugin.push(script);
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
EOF

  run_node_merge "$mergejs" "$settings" "$script"
  case $? in
    0) echo "installed: $script" ;;
    4) echo "already installed: $script" ;;
    *) echo "installed: $script"
       echo "manual step: add to $settings ->"
       echo '  { "plugin": ["'"$script"'"] }' ;;
  esac
  rm -f "$mergejs"
}

# --- pi / omp ---------------------------------------------------------------
install_extension() { # <src-in-repo> <dest>
  fetch "$1" "$2" || die "download failed"
  echo "installed: $2"
}

target="${1:-}"
case "$target" in
  claude)   install_claude ;;
  opencode) install_opencode ;;
  pi)
    echo "note: native install preferred: pi install https://github.com/hayfever/toksec"
    mkdir -p "$HOME/.pi/agent/extensions"
    install_extension "pi/toksec.ts" "$HOME/.pi/agent/extensions/${NAME}.ts"
    ;;
  omp)
    echo "note: native install preferred:"
    echo "  omp plugin marketplace add hayfever/toksec && omp plugin install --scope user ${NAME}@toksec"
    agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
    mkdir -p "$agent_dir/extensions"
    install_extension "omp/toksec.ts" "$agent_dir/extensions/${NAME}.ts"
    ;;
  all)
    install_claude
    echo
    install_opencode
    echo
    install_extension "pi/toksec.ts" "$HOME/.pi/agent/extensions/${NAME}.ts"
    echo
    agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
    mkdir -p "$agent_dir/extensions"
    install_extension "omp/toksec.ts" "$agent_dir/extensions/${NAME}.ts"
    ;;
  *)
    echo "error: missing or unknown target" >&2
    echo >&2
    usage >&2
    exit 2
    ;;
esac