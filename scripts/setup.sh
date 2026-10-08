#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/shell-common.sh"

require_node
require_ffmpeg

backend_python="$project_root/backend/venv/bin/python"
if [ ! -x "$backend_python" ]; then
  if [ -d "$project_root/backend/venv" ]; then
    echo 'backend/venv exists but is not a working macOS/Linux environment. Do not copy a Windows venv; create it locally.' >&2
    exit 1
  fi
  python_command="${PYTHON:-python3.11}"
  if ! command -v "$python_command" >/dev/null 2>&1; then
    echo 'Python 3.11 was not found. On macOS run: brew install python@3.11' >&2
    exit 1
  fi
  "$python_command" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'
  "$python_command" -m venv "$project_root/backend/venv"
fi

"$backend_python" -m pip install -r "$project_root/backend/requirements-api.txt"
cd "$project_root/frontend"
npm ci
echo 'Dependencies installed. Start the API and frontend in separate terminals with scripts/start-backend.sh and scripts/start-frontend.sh.'
