# 훅 켜기 (윈도우) — pwsh tools/setup_hooks.ps1
$ErrorActionPreference = 'Stop'
Set-Location (git rev-parse --show-toplevel)
git config core.hooksPath .githooks
Write-Host "OK core.hooksPath =" (git config core.hooksPath)
Write-Host "  hooks:" ((Get-ChildItem .githooks).Name -join ' ')
$n = (git ls-files | Measure-Object -Line).Lines
Write-Host "  tracked files: $n  (2026-11-22 baseline 54825)"
