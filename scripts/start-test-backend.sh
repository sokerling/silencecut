#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/shell-common.sh"

require_backend
require_ffmpeg
fixture_root="$project_root/backend/.editor_test_e2e"
fixture_video="$fixture_root/fixture.mp4"
mkdir -p "$fixture_root"
if [ ! -f "$fixture_video" ]; then
  "$ffmpeg_binary" -hide_banner -loglevel error -nostdin \
    -f lavfi -i 'testsrc2=size=640x360:rate=60000/1001:duration=12' \
    -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=12' \
    -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p \
    -c:a aac -b:a 128k -movflags +faststart "$fixture_video"
fi
export VIDEOEDITOR_VIDEO_PATH="$fixture_video"
export VIDEOEDITOR_RESULTS_DIR="$fixture_root/results"
export VIDEOEDITOR_EXPORTS_DIR="$fixture_root/exports"
echo "Temporary test results: $VIDEOEDITOR_RESULTS_DIR"
cd "$project_root/backend"
exec "$backend_python" -m uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8001}"
