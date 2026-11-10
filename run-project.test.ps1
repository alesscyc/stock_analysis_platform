$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('stock-launcher-' + [guid]::NewGuid())
$originalPath = $env:PATH
try {
    New-Item -ItemType Directory -Path $fixture, "$fixture/backend", "$fixture/frontend" | Out-Null
    Copy-Item "$PSScriptRoot/run-project.ps1" $fixture
    Set-Content "$fixture/npm.cmd" '@echo off
node "%~dp0server.cjs"'
    Set-Content "$fixture/server.cjs" @'
const fs = require('node:fs');
const path = require('node:path');
const area = path.basename(process.cwd());
fs.writeFileSync(path.join('..', `${area}.pid`), String(process.pid));
console.log(`${area} started`);
setTimeout(() => process.exit(area === 'backend' ? 7 : 9), area === 'backend' ? 1500 : 10000);
'@
    $env:PATH = "$fixture;$originalPath"
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$fixture/run-project.ps1" 2>&1
    if ($LASTEXITCODE -ne 7) { throw "Expected exit code 7; got $LASTEXITCODE. Output: $output" }
    foreach ($area in 'backend', 'frontend') {
        if (($output -join "`n") -notmatch "$area started") { throw "$area did not start" }
        $childId = [int](Get-Content "$fixture/$area.pid")
        if (Get-Process -Id $childId -ErrorAction SilentlyContinue) { throw "$area was left running" }
    }
    Write-Host 'PASS: both services share output; failure propagates and stops remaining process tree.'
} finally {
    $env:PATH = $originalPath
    # Only remove the unique fixture directory created by this test.
    if (Test-Path -LiteralPath $fixture) {
        $resolvedFixture = (Resolve-Path -LiteralPath $fixture).Path
        if (-not $resolvedFixture.StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
            throw "Fixture escaped temporary directory: $resolvedFixture"
        }
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}
