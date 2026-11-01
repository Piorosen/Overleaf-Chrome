#!/usr/bin/env bash
# Overleaf AI — remove the Native Messaging host installed by install-host.sh.
set -euo pipefail

HOST_NAME="com.olai.cli_bridge"
OS="$(uname -s)"

if [[ "$OS" == "Darwin" ]]; then
  INSTALL_DIR="$HOME/Library/Application Support/overleaf-ai-host"
  BASE="$HOME/Library/Application Support"
  BROWSER_DIRS=(
    "$BASE/Google/Chrome" "$BASE/Google/Chrome Beta" "$BASE/Google/Chrome Canary" "$BASE/Google/Chrome Dev" "$BASE/Google/Chrome for Testing"
    "$BASE/Chromium" "$BASE/BraveSoftware/Brave-Browser" "$BASE/Microsoft Edge"
    "$BASE/Vivaldi" "$BASE/Arc/User Data"
  )
else
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/overleaf-ai-host"
  BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
  BROWSER_DIRS=(
    "$BASE/google-chrome" "$BASE/google-chrome-beta" "$BASE/google-chrome-unstable" "$BASE/chromium"
    "$HOME/snap/chromium/common/chromium" "$HOME/.var/app/com.google.Chrome/config/google-chrome"
    "$HOME/.var/app/org.chromium.Chromium/config/chromium" "$HOME/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"
    "$BASE/BraveSoftware/Brave-Browser" "$BASE/microsoft-edge" "$BASE/vivaldi"
  )
fi

for dir in "${BROWSER_DIRS[@]}"; do
  f="$dir/NativeMessagingHosts/$HOST_NAME.json"
  if [[ -f "$f" ]]; then rm -f "$f"; echo "✓ 삭제: $f"; fi
done

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "✓ 삭제: $INSTALL_DIR"
fi
# private work directories used by the host (and the pre-0.4 shared temp dir)
for w in "$HOME/Library/Caches/overleaf-ai-host" "${XDG_RUNTIME_DIR:-/nonexistent}/overleaf-ai-host" "${XDG_CACHE_HOME:-$HOME/.cache}/overleaf-ai-host" "${TMPDIR:-/tmp}/overleaf-ai-host"; do
  if [[ -d "$w" && ! -L "$w" && -O "$w" ]]; then rm -rf "$w"; echo "✓ 삭제: $w"; fi
done
echo "제거 완료."
