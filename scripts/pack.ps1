# Deployment packer: zip the repo for server upload.
# Excludes deps/build artifacts/local files - especially web\node_modules
# (a previous Copy-Item based version leaked node_modules into the archive).
# Usage: ./scripts/pack.ps1 [-Out livedemo-pack.zip]
param(
    [string]$Out = "livedemo-pack.zip"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (Test-Path $Out) { Remove-Item $Out -Force }
    $stage = Join-Path $env:TEMP ("livedemo-pack-" + [guid]::NewGuid().ToString('N').Substring(0, 8))

    # robocopy /E copies the tree; /XD excludes dep/build dirs; /XF excludes local sensitive files.
    # robocopy exit codes 0-7 are success (1 = files copied); >= 8 is a failure.
    robocopy $root $stage /E /NFL /NDL /NJH /NJS /NP /XD node_modules dist target data test-results playwright-report .vite .gradle .git .idea /XF .env *.log
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit=$LASTEXITCODE)" }

    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $Out -Force
    Remove-Item $stage -Recurse -Force

    # Verification: the zip must not contain node_modules / .env
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Out).Path)
    try {
        $bad = @($zip.Entries | Where-Object { $_.FullName -match 'node_modules' -or $_.FullName -match '(^|/)\.env$' })
        if ($bad.Count -gt 0) {
            throw ("forbidden files leaked into pack: " + (($bad | Select-Object -First 5 -ExpandProperty FullName) -join ', '))
        }
    } finally { $zip.Dispose() }

    Write-Host ("pack ok: {0} ({1:N1} MB), verified no node_modules/.env" -f (Resolve-Path $Out).Path, ((Get-Item $Out).Length / 1MB))
} finally {
    Pop-Location
}