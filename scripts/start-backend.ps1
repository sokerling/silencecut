param(
    [int]$Port = 8000,
    [string]$ListenHost = '127.0.0.1',
    [switch]$Reload
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot 'backend/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw 'Missing backend virtual environment. Run: powershell -ExecutionPolicy Bypass -File scripts/setup.ps1'
}
& $pythonPath -c 'import fastapi, uvicorn'
if ($LASTEXITCODE -ne 0) { throw 'Missing API dependencies. Run scripts/setup.ps1.' }
foreach ($name in @('ffmpeg', 'ffprobe')) {
    $configuredPath = [Environment]::GetEnvironmentVariable("VIDEO_EDITOR_$($name.ToUpper())")
    if ($configuredPath) {
        if (-not (Get-Command $configuredPath -ErrorAction SilentlyContinue)) { throw "Cannot find configured $name executable." }
    } elseif (-not (Get-Command "$name.exe" -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath "C:/Program Files/FFmpeg/$name.exe")) {
        throw 'Install FFmpeg (including ffprobe) and add it to PATH.'
    }
}

$serverArguments = @('-m', 'uvicorn', 'app.main:app', '--host', $ListenHost, '--port', "$Port")
if ($Reload) { $serverArguments += '--reload' }
Push-Location (Join-Path $projectRoot 'backend')
try {
    & $pythonPath @serverArguments
    if ($LASTEXITCODE -ne 0) { throw 'API server exited with an error.' }
} finally {
    Pop-Location
}
