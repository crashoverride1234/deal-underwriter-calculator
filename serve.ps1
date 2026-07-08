$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
    $listener.Start()
    Write-Host "Server started at http://localhost:$port/"
} catch {
    Write-Error "Failed to start listener: $_"
    exit 1
}

$currentDir = $PSScriptRoot
if (-not $currentDir) {
    $currentDir = Get-Location
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq "/") {
            $urlPath = "/index.html"
        }
        
        # Strip leading slash and join with script dir
        $cleanPath = $urlPath.TrimStart('/')
        $filePath = Join-Path $currentDir $cleanPath
        
        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            
            # Content Type mapping
            if ($filePath.EndsWith(".html")) {
                $response.ContentType = "text/html; charset=utf-8"
            } elseif ($filePath.EndsWith(".css")) {
                $response.ContentType = "text/css; charset=utf-8"
            } elseif ($filePath.EndsWith(".js")) {
                $response.ContentType = "application/javascript; charset=utf-8"
            } elseif ($filePath.EndsWith(".png")) {
                $response.ContentType = "image/png"
            } elseif ($filePath.EndsWith(".jpg") -or $filePath.EndsWith(".jpeg")) {
                $response.ContentType = "image/jpeg"
            } elseif ($filePath.EndsWith(".svg")) {
                $response.ContentType = "image/svg+xml"
            } elseif ($filePath.EndsWith(".json") -or $filePath.EndsWith(".webmanifest")) {
                $response.ContentType = "application/manifest+json; charset=utf-8"
            }

            # Dev server: always revalidate so edits show up immediately
            $response.Headers.Add("Cache-Control", "no-cache")
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.ContentType = "text/plain"
            $response.ContentLength64 = $errBytes.Length
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
    } catch {
        # Silent fail or log
        Write-Host "Error handling request: $_"
    } finally {
        if ($response) {
            try { $response.Close() } catch {}
        }
    }
}
