# Builds the native plugin with the Visual Studio Build Tools.
# No developer shell needed: the Build Tools are found with vswhere.
#
#   .\tools\build-native.ps1            # Release
#   .\tools\build-native.ps1 -Config Debug

param(
    [ValidateSet('Release', 'Debug')]
    [string] $Config = 'Release'
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw 'vswhere not found. Install the Build Tools: see docs/dev-setup.md.' }

$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'No Visual Studio install with the C++ tools. See docs/dev-setup.md.' }

$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (-not $cmake) { $cmake = Join-Path $vs 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' }
if (-not (Test-Path $cmake)) { throw "CMake not found at $cmake" }

# Every part of REDnode shares one version (VERSION); stop if one differs.
node (Join-Path $repo 'tools/version.mjs') --check
if ($LASTEXITCODE) { throw 'The parts of REDnode have different versions: run node tools/version.mjs <version>.' }

$src = Join-Path $repo 'native'
$build = Join-Path $src 'build'

& $cmake -S $src -B $build -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE) { throw 'CMake configure failed.' }

& $cmake --build $build --config $Config
if ($LASTEXITCODE) { throw 'Build failed.' }

& (Join-Path $build "$Config\REDnode_tests.exe")
if ($LASTEXITCODE) { throw 'Unit tests failed.' }
& (Join-Path $build "$Config\REDnode_json_tests.exe")
if ($LASTEXITCODE) { throw 'JSON unit tests failed.' }
& (Join-Path $build "$Config\REDnode_capture_tests.exe")
if ($LASTEXITCODE) { throw 'Capture unit tests failed.' }

Write-Output "Staged plugin: $build\dist\red4ext\plugins\REDnode"
