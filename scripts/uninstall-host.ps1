# Overleaf AI — remove the Windows Native Messaging host installed by install-host.ps1.
$ErrorActionPreference = 'Continue'
$HostName = 'com.olai.cli_bridge'
foreach ($k in 'HKCU:\Software\Google\Chrome\NativeMessagingHosts', 'HKCU:\Software\Chromium\NativeMessagingHosts',
               'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts', 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts') {
  $key = Join-Path $k $HostName
  if (Test-Path $key) { Remove-Item -Force -Path $key; Write-Host "✓ removed $key" }
}
$dir = Join-Path $env:LOCALAPPDATA 'overleaf-ai-host'
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir; Write-Host "✓ removed $dir" }
