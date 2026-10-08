#!/usr/bin/env bash
# Shared paths work with macOS's Bash 3.2 and directories containing spaces.
set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Homebrew's versioned Node/Python formulas may not be linked into the default PATH.
for brew_prefix in /usr/local /opt/homebrew; do
  if [ -d "$brew_prefix" ]; then
    export PATH="$brew_prefix/opt/node@24/bin:$brew_prefix/opt/python@3.11/bin:$brew_prefix/bin:$PATH"
  fi
done

require_node() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo 'Node.js/npm were not found. On macOS run: brew install node@24' >&2
    return 1
  fi
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Use Node.js 24 LTS (minimum: 22.12)."); process.exit(1); }'
}

require_backend() {
  backend_python="$project_root/backend/venv/bin/python"
  if [ ! -x "$backend_python" ]; then
    echo 'The backend virtual environment is missing. Run: bash scripts/setup.sh' >&2
    return 1
  fi
  if ! "$backend_python" -c 'import fastapi, uvicorn' >/dev/null 2>&1; then
    echo 'API dependencies are missing. Run: bash scripts/setup.sh' >&2
    return 1
  fi
}

require_ffmpeg() {
  ffmpeg_binary="${VIDEO_EDITOR_FFMPEG:-ffmpeg}"
  ffprobe_binary="${VIDEO_EDITOR_FFPROBE:-ffprobe}"
  for binary in "$ffmpeg_binary" "$ffprobe_binary"; do
    if ! command -v "$binary" >/dev/null 2>&1; then
      echo 'FFmpeg/ffprobe were not found. On macOS run: brew install ffmpeg' >&2
      return 1
    fi
  done
}
