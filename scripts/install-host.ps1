# Overleaf AI — install the Native Messaging host on Windows (Chrome, Edge, Brave, Chromium).
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-host.ps1 [-ExtensionId <id>]
#
# Best effort: the macOS/Linux installer (install-host.sh) is the tested path.
# Re-run after updating host\*.js or after installing/moving the claude/codex CLI.
param([string]$ExtensionId = 'lbggnmchbhbpojfdpcfknoppbjpnmgnn')
$ErrorActionPreference = 'Stop'

$HostName = 'com.olai.cli_bridge'
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "확장 ID 형식이 올바르지 않습니다: $ExtensionId" }

$RepoDir = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA 'overleaf-ai-host'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Chrome starts the host with the PATH of the browser process; bake in the user's full PATH.
$UserPath = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';'
$env:Path = $UserPath

function Find-Bin([string]$name, [string[]]$extra) {
  foreach ($p in $extra) { if ($p -and (Test-Path $p)) { return (Resolve-Path $p).Path } }
  $c = Get-Command "$name.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { $c = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if ($c) { return $c.Source }
  return ''
}

$Node = Find-Bin 'node' @()
if (-not $Node) { throw 'node 를 찾을 수 없습니다. Node.js 18+ 를 설치한 뒤 다시 실행하세요.' }
$NodeMajor = [int](& $Node -p 'process.versions.node.split(".")[0]')
if ($NodeMajor -lt 18) { throw "Node.js 18 이상이 필요합니다 (현재 $(& $Node --version))." }
$Claude = Find-Bin 'claude' @("$env:USERPROFILE\.local\bin\claude.exe")
$Codex = Find-Bin 'codex' @()
Write-Host "• node   : $Node"
Write-Host "• claude : $(if ($Claude) { $Claude } else { '(없음 — Claude 백엔드 사용 불가)' })"
Write-Host "• codex  : $(if ($Codex) { $Codex } else { '(없음 — Codex 백엔드 사용 불가)' })"

foreach ($f in 'host.js', 'mcp-server.js', 'agent-tools.js') { Copy-Item -Force (Join-Path $RepoDir "host\$f") $InstallDir }

# config.json (written by node: UTF-8 without BOM; keys added by hand are preserved).
& $Node -e @'
const fs = require("fs");
const [file, claudePath, codexPath, p] = process.argv.slice(1);
let prev = {};
try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
fs.writeFileSync(file, JSON.stringify({ ...prev, claudePath: claudePath || "claude", codexPath: codexPath || "codex", path: p, installedAt: new Date().toISOString() }, null, 2) + "\n");
'@ (Join-Path $InstallDir 'config.json') "$Claude" "$Codex" "$UserPath"

$Launcher = Join-Path $InstallDir 'run-host.bat'
$bat = "@echo off`r`nchcp 65001 >nul`r`n`"$Node`" `"%~dp0host.js`" %*`r`n"
[IO.File]::WriteAllText($Launcher, $bat, (New-Object Text.UTF8Encoding $false))

$Manifest = Join-Path $InstallDir "$HostName.json"
& $Node -e @'
const [file, name, launcher, extId] = process.argv.slice(1);
require("fs").writeFileSync(file, JSON.stringify({ name, description: "Overleaf AI bridge to the local Claude Code / Codex CLI", path: launcher, type: "stdio", allowed_origins: [`chrome-extension://${extId}/`] }, null, 2) + "\n");
'@ $Manifest $HostName $Launcher $ExtensionId

$Keys = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
  'HKCU:\Software\Chromium\NativeMessagingHosts',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
  'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'
)
foreach ($k in $Keys) {
  $key = Join-Path $k $HostName
  New-Item -Force -Path $key | Out-Null
  Set-Item -Path $key -Value $Manifest
  Write-Host "✓ $key"
}

Write-Host ''
Write-Host "설치 완료. 호스트 위치: $InstallDir"
Write-Host "확장 ID: $ExtensionId"
Write-Host "브라우저의 확장 프로그램 페이지에서 'Overleaf AI' 를 새로고침(⟳)하면 적용됩니다."
