# Antigravity Underwriter — desktop launcher
# Starts the local server (if not already running) and opens the app
# in its own Edge app window (no tabs, no address bar).

$port = 8080

$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    # serve.ps1 honors $env:PORT (for the Claude preview); pin it so an
    # ambient PORT variable can't send the child to a different port
    $env:PORT = "$port"
    Start-Process powershell -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', (Join-Path $PSScriptRoot 'serve.ps1')
    )
    # Wait up to 5s for the server to come up
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
    }
}

$url = "http://localhost:$port/"
$edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edge) {
    Start-Process $edge "--app=$url"
} else {
    Start-Process $url  # fall back to default browser
}
