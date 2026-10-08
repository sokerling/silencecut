param(
    [int]$Port = 5173,
    [string]$ListenHost = '127.0.0.1'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$portableNodeDir = Join-Path $projectRoot '.tools/node-v24.21.0-win-x64'
if (Test-Path -LiteralPath (Join-Path $portableNodeDir 'node.exe')) {
    $nodePath = Join-Path $portableNodeDir 'node.exe'
} else {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Install Node.js 24 LTS, then run scripts/setup.ps1.' }
    $nodePath = $nodeCommand.Source
}
$npmPath = Join-Path (Split-Path -Parent $nodePath) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmPath)) { throw 'npm.cmd was not found beside node.exe.' }
& $nodePath -e 'const version = process.versions.node.split(/\./).map(Number); process.exit(Number(version[0] < 22 || (version[0] === 22 && version[1] < 12)));'
if ($LASTEXITCODE -ne 0) { throw 'Use Node.js 24 LTS (minimum: 22.12).' }
$previousNodePath = $env:PATH
$env:PATH = (Split-Path -Parent $nodePath) + ';' + $previousNodePath
Push-Location (Join-Path $projectRoot 'frontend')
try {
    if (-not (Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) {
        throw 'Missing frontend dependencies. Run: powershell -ExecutionPolicy Bypass -File scripts/setup.ps1'
    }
    & $npmPath run dev -- --host $ListenHost --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'Frontend server exited with an error.' }
} finally {
    Pop-Location
    $env:PATH = $previousNodePath
}
