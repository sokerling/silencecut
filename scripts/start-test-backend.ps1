param([int]$Port = 8001)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path $projectRoot 'backend/.editor_test_e2e'
$fixtureVideo = Join-Path $fixtureRoot 'fixture.mp4'
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
$ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$ffmpegPath = if ($ffmpegCommand) { $ffmpegCommand.Source } else { 'C:\Program Files\FFmpeg\ffmpeg.exe' }
if (-not (Test-Path -LiteralPath $fixtureVideo)) {
    & $ffmpegPath -hide_banner -loglevel error -nostdin -f lavfi -i 'testsrc2=size=640x360:rate=60000/1001:duration=12' -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=12' -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart $fixtureVideo
    if ($LASTEXITCODE -ne 0) { throw 'Cannot generate the temporary test video.' }
}
$previousTestVideo = $env:VIDEOEDITOR_VIDEO_PATH
$previousTestResults = $env:VIDEOEDITOR_RESULTS_DIR
$previousTestExports = $env:VIDEOEDITOR_EXPORTS_DIR
$env:VIDEOEDITOR_VIDEO_PATH = $fixtureVideo
$env:VIDEOEDITOR_RESULTS_DIR = Join-Path $fixtureRoot 'results'
$env:VIDEOEDITOR_EXPORTS_DIR = Join-Path $fixtureRoot 'exports'
Write-Output "Temporary test results: $env:VIDEOEDITOR_RESULTS_DIR"
Push-Location (Join-Path $projectRoot 'backend')
try {
    & (Join-Path $projectRoot 'backend/venv/Scripts/python.exe') -m uvicorn app.main:app --host 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'Test API exited with an error.' }
} finally {
    Pop-Location
    $env:VIDEOEDITOR_VIDEO_PATH = $previousTestVideo
    $env:VIDEOEDITOR_RESULTS_DIR = $previousTestResults
    $env:VIDEOEDITOR_EXPORTS_DIR = $previousTestExports
}
