# Copies the staged plugin into the game, or removes it.
#
#   .\tools\deploy-native.ps1            # install into the default Steam path
#   .\tools\deploy-native.ps1 -Remove    # uninstall
#   .\tools\deploy-native.ps1 -GameDir 'D:\Games\Cyberpunk 2077'

param(
    [string] $GameDir = 'C:\Program Files (x86)\Steam\steamapps\common\Cyberpunk 2077',
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $repo 'native\build\dist\red4ext\plugins\REDnode'
$target = Join-Path $GameDir 'red4ext\plugins\REDnode'

if (-not (Test-Path (Join-Path $GameDir 'red4ext\RED4ext.dll'))) { throw "RED4ext not found under $GameDir" }
if (Get-Process Cyberpunk2077 -ErrorAction SilentlyContinue) { throw 'Close the game first. RED4ext keeps the plugin locked while it runs.' }

if ($Remove) {
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Write-Output "Removed $target"
    return
}

if (-not (Test-Path (Join-Path $stage 'REDnode.dll'))) { throw 'Nothing staged. Run tools\build-native.ps1 first.' }

New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item -Recurse -Force (Join-Path $stage '*') $target
Write-Output "Deployed to $target"
