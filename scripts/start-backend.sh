#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/shell-common.sh"

require_backend
require_ffmpeg
cd "$project_root/backend"
exec "$backend_python" -m uvicorn app.main:app --host "${LISTEN_HOST:-127.0.0.1}" --port "${PORT:-8000}" "$@"
