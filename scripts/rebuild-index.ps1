param(
  [switch]$KeepUploads
)

$root = Split-Path -Parent $PSScriptRoot
$uploads = Join-Path $root "backend\data\uploads"
$db = Join-Path $root "backend\data\metadata.db"
$chroma = Join-Path $root "backend\chroma_db"

Write-Host "[info] Stopping running python/uvicorn processes..."
Get-Process | Where-Object { $_.ProcessName -match "python|uvicorn" } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "[info] Clearing vector store and metadata..."
if (Test-Path $chroma) { Remove-Item -Recurse -Force $chroma }
if (Test-Path $db) { Remove-Item -Force $db }

if (-not $KeepUploads) {
  Write-Host "[info] Clearing uploads..."
  if (Test-Path $uploads) { Remove-Item -Recurse -Force $uploads }
} else {
  Write-Host "[info] Keeping uploads folder."
}

Write-Host "[info] Done. Restart backend and re-upload documents to rebuild the index."
