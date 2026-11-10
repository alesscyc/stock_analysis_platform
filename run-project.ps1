$ErrorActionPreference = 'Stop'
$servers = @()
$exitCode = 1

try {
    Write-Host 'Frontend: http://localhost:5173 | Backend: http://localhost:3001'
    Write-Host 'Press Ctrl+C to stop both services.'
    foreach ($area in 'backend', 'frontend') {
        $server = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev' `
            -WorkingDirectory (Join-Path $PSScriptRoot $area) -NoNewWindow -PassThru
        # Keep the process handle open so Windows preserves its exit code.
        $null = $server.Handle
        $servers += $server
    }
    while ($true) {
        foreach ($server in $servers) {
            if ($server.HasExited) {
                $exitCode = $server.ExitCode
                throw "Development server exited (code $exitCode). Stopping both services."
            }
        }
        Start-Sleep -Milliseconds 200
    }
} catch {
    Write-Host $_ -ForegroundColor Red
} finally {
    foreach ($server in $servers) {
        if (-not $server.HasExited) {
            & taskkill.exe /PID $server.Id /T /F 2>$null | Out-Null
        }
    }
}
exit $exitCode
