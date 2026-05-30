# Run once as admin to add a permanent Defender exclusion, then builds.
# After the first run, plain "npm run electron-build" works forever.
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`"" -Wait
  exit
}

Write-Host "Administrator: adding Defender exclusion..." -ForegroundColor Cyan
Add-MpPreference -ExclusionPath $projectDir
Write-Host "Exclusion added for: $projectDir" -ForegroundColor Green

# Restore PATH so npm is findable (elevated shells sometimes miss user PATH)
$machinePath = [System.Environment]::GetEnvironmentVariable("PATH","Machine")
$userPath    = [System.Environment]::GetEnvironmentVariable("PATH","User")
$env:PATH    = "$machinePath;$userPath"

# Kill any running app instances so they don't lock DLLs in dist
taskkill /F /IM TaskFish.exe 2>&1 | Out-Null

$dist = Join-Path $projectDir "dist_electron"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }

Set-Location $projectDir
Write-Host "Building..." -ForegroundColor Cyan
& npm run electron-build

Write-Host ""
Write-Host "Done. Future builds no longer need this script." -ForegroundColor Green
Read-Host "Press Enter to close"
