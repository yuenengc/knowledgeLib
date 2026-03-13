param(
  [int]$Port = 8000
)

$root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $root "backend\.venv\Scripts\python.exe"
$venvUvicorn = Join-Path $root "backend\.venv\Scripts\uvicorn.exe"

if (-not (Test-Path $venvPython)) {
  Write-Host "[error] Virtualenv not found at backend\.venv. Create it first:" -ForegroundColor Red
  Write-Host "  py -3.12 -m venv backend\.venv"
  exit 1
}

Write-Host "[info] Installing backend dependencies..."
& $venvPython -m pip install -r (Join-Path $root "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) {
  Write-Host "[error] pip install failed." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "[info] Starting backend on port $Port..."
& $venvUvicorn "backend.main:app" --reload --host 0.0.0.0 --port $Port
