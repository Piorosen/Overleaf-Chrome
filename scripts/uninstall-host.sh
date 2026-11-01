#!/usr/bin/env bash
# Overleaf AI — remove the Native Messaging host installed by install-host.sh.
set -euo pipefail

HOST_NAME="com.olai.cli_bridge"
OS="$(uname -s)"

if [[ "$OS" == "Darwin" ]]; then
  INSTALL_DIR="$HOME/Library/Application Support/overleaf-ai-host"
  BASE="$HOME/Library/Application Support"
  BROWSER_DIRS=(
    "$BASE/Google/Chrome" "$BASE/Google/Chrome Beta" "$BASE/Google/Chrome Canary"
    "$BASE/Chromium" "$BASE/BraveSoftware/Brave-Browser" "$BASE/Microsoft Edge"
    "$BASE/Vivaldi" "$BASE/Arc/User Data"
  )
else
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/overleaf-ai-host"
  BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
  BROWSER_DIRS=(
    "$BASE/google-chrome" "$BASE/google-chrome-beta" "$BASE/chromium"
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
echo "제거 완료."
