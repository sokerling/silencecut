param([string]$Python = '')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$venvRoot = Join-Path $backendRoot 'venv'
$pythonPath = Join-Path $venvRoot 'Scripts/python.exe'

# Reuse the research environment instead of creating a second virtual environment.
if (-not (Test-Path -LiteralPath $pythonPath)) {
    if (Test-Path -LiteralPath $venvRoot) {
        throw 'backend/venv exists but is not a working Windows environment. Do not copy a macOS venv; create it locally.'
    }
    $pythonArguments = @()
    if ($Python) {
        $pythonCommand = $Python
    } elseif (Get-Command py.exe -ErrorAction SilentlyContinue) {
        $pythonCommand = (Get-Command py.exe).Source
        $pythonArguments = @('-3.11')
    } else {
        $command = Get-Command python.exe -ErrorAction SilentlyContinue
        if (-not $command) { throw 'Install Python 3.11, then run this setup script again.' }
        $pythonCommand = $command.Source
    }
    & $pythonCommand @pythonArguments -c 'import sys; sys.exit(sys.version_info < (3, 11))'
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or newer was not found. Use -Python with its executable path.' }
    & $pythonCommand @pythonArguments -m venv $venvRoot
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed.' }
}

$portableNodeDir = Join-Path $projectRoot '.tools/node-v24.21.0-win-x64'
if (Test-Path -LiteralPath (Join-Path $portableNodeDir 'node.exe')) {
    $nodePath = Join-Path $portableNodeDir 'node.exe'
} else {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Install Node.js 24 LTS, then run this setup script again.' }
    $nodePath = $nodeCommand.Source
}
$npmPath = Join-Path (Split-Path -Parent $nodePath) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmPath)) { throw 'npm.cmd was not found beside node.exe.' }
& $nodePath -e 'const version = process.versions.node.split(/\./).map(Number); process.exit(Number(version[0] < 22 || (version[0] === 22 && version[1] < 12)));'
if ($LASTEXITCODE -ne 0) { throw 'Use Node.js 24 LTS (minimum: 22.12).' }
foreach ($name in @('ffmpeg', 'ffprobe')) {
    $configuredPath = [Environment]::GetEnvironmentVariable("VIDEO_EDITOR_$($name.ToUpper())")
    if ($configuredPath) {
        if (-not (Get-Command $configuredPath -ErrorAction SilentlyContinue)) { throw "Cannot find configured $name executable." }
    } elseif (-not (Get-Command "$name.exe" -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath "C:/Program Files/FFmpeg/$name.exe")) {
        throw 'Install FFmpeg (including ffprobe) and add it to PATH, then run setup again.'
    }
}

& $pythonPath -m pip install -r (Join-Path $backendRoot 'requirements-api.txt')
if ($LASTEXITCODE -ne 0) { throw 'API dependency installation failed.' }
$previousNodePath = $env:PATH
$env:PATH = (Split-Path -Parent $nodePath) + ';' + $previousNodePath
Push-Location (Join-Path $projectRoot 'frontend')
try {
    & $npmPath ci
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
} finally {
    Pop-Location
    $env:PATH = $previousNodePath
}
Write-Output 'Dependencies installed. Start the API and frontend in separate terminals with scripts/start-backend.ps1 and scripts/start-frontend.ps1.'
