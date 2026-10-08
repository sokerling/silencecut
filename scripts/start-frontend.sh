#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/shell-common.sh"

require_node
if [ ! -f "$project_root/frontend/node_modules/vite/bin/vite.js" ]; then
  echo 'Frontend dependencies are missing. Run: bash scripts/setup.sh' >&2
  exit 1
fi
cd "$project_root/frontend"
exec npm run dev -- --host "${LISTEN_HOST:-127.0.0.1}" --port "${PORT:-5173}" "$@"
