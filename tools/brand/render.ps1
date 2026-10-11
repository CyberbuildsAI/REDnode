# Renders the brand images from tools/brand/brand.html with headless Chrome,
# then regenerates the README badges.
#
#   .\tools\brand\render.ps1
#
# Output (committed):
#   docs/assets/brand/banner.png   2560 x 640  (1280 x 320 at 2x), README header
#   docs/assets/brand/social.png   1280 x 640, upload in Settings > General > Social preview
#   docs/assets/brand/badges/*.svg
#   docs/assets/brand/icon.png           256 x 256, app and site icon

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$src = Join-Path $PSScriptRoot 'brand.html'
$out = Join-Path $repo 'docs\assets\brand'
New-Item -ItemType Directory -Force $out | Out-Null

$chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome or Edge not found.' }

$url = 'file:///' + ($src -replace '\\', '/')
$profileDir = Join-Path $env:TEMP 'rednode-brand-chrome'

function Render($query, $file, $width, $height, $scale) {
    $target = Join-Path $out $file
    if (Test-Path $target) { Remove-Item $target }
    # Chrome logs harmless errors to stderr. Windows PowerShell 5.1 would treat them as fatal under 'Stop'.
    $ErrorActionPreference = 'Continue'
    # The virtual time budget gives the web fonts time to load before the screenshot.
    & $chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run "--user-data-dir=$profileDir" `
        "--window-size=$width,$height" "--force-device-scale-factor=$scale" `
        --virtual-time-budget=8000 "--screenshot=$target" "$url`?$query" 2>$null | Out-Null
    if (-not (Test-Path $target)) { throw "Render failed: $file" }
    Write-Output "Rendered $target"
}

Render 'banner' 'banner.png' 1280 320 2
Render 'social' 'social.png' 1280 640 1

# Square icon, 256 x 256 with transparent cut corners.
$iconUrl = 'file:///' + ((Join-Path $PSScriptRoot 'icon.html') -replace '\\', '/')
$icon = Join-Path $repo 'docs\assets\brand\icon.png'
New-Item -ItemType Directory -Force (Split-Path $icon) | Out-Null
if (Test-Path $icon) { Remove-Item $icon }
$ErrorActionPreference = 'Continue'
& $chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run "--user-data-dir=$profileDir" `
    --window-size=256,256 --default-background-color=00000000 --virtual-time-budget=8000 `
    "--screenshot=$icon" $iconUrl 2>$null | Out-Null
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $icon)) { throw 'Render failed: icon.png' }
Write-Output "Rendered $icon"

python -I (Join-Path $PSScriptRoot 'badges.py') (Join-Path $out 'badges')
