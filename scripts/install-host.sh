#!/usr/bin/env bash
# Overleaf AI — install the Native Messaging host for Chrome (and other Chromium browsers).
#
#   ./scripts/install-host.sh [--with-matplotlib] [EXTENSION_ID]
#
# EXTENSION_ID defaults to the fixed ID derived from the "key" in extension/manifest.json.
# --with-matplotlib: if no Python with matplotlib is found, create a private virtualenv for the
#   figure feature in the install directory and install matplotlib + numpy into it (downloads ~40 MB).
# OLAI_PYTHON=/path/to/python overrides the Python used for figures.
# Re-run this script after updating host/*.js or after installing/moving the claude/codex CLI or Python.
set -euo pipefail

HOST_NAME="com.olai.cli_bridge"
DEFAULT_EXT_ID="lbggnmchbhbpojfdpcfknoppbjpnmgnn"
EXT_ID="$DEFAULT_EXT_ID"
WITH_MPL=0
for arg in "$@"; do
  case "$arg" in
    --with-matplotlib) WITH_MPL=1 ;;
    -*) echo "✗ 알 수 없는 옵션: $arg" >&2; exit 1 ;;
    *) EXT_ID="$arg" ;;
  esac
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"

if [[ ! "$EXT_ID" =~ ^[a-p]{32}$ ]]; then
  echo "✗ 확장 ID 형식이 올바르지 않습니다: $EXT_ID (a-p 소문자 32자)" >&2
  exit 1
fi

# Host files live outside ~/Desktop, ~/Documents, ~/Downloads so macOS privacy
# protection (TCC) never blocks Chrome from launching them.
if [[ "$OS" == "Darwin" ]]; then
  INSTALL_DIR="$HOME/Library/Application Support/overleaf-ai-host"
else
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/overleaf-ai-host"
fi

# Chrome starts the host with a minimal PATH, so capture the user's login-shell PATH
# (Homebrew, nvm, ~/.local/bin ...) and bake it into the launcher.
USER_SHELL="${SHELL:-/bin/zsh}"
# stdin from /dev/null and a 10 s limit so an rc file that prompts or hangs cannot block the installer.
USER_PATH="$(perl -e 'alarm 10; exec @ARGV' "$USER_SHELL" -lic 'printf "__OLAI_PATH__%s\n" "$PATH"' </dev/null 2>/dev/null | sed -n 's/^.*__OLAI_PATH__//p' | tail -n 1 || true)"
if [[ -z "$USER_PATH" ]]; then
  echo "⚠ 로그인 셸에서 PATH 를 읽지 못해 현재 PATH 를 사용합니다." >&2
  USER_PATH="$PATH"
fi

find_bin() { (PATH="$USER_PATH"; command -v "$1" 2>/dev/null || true); }

NODE_BIN="$(find_bin node)"
CLAUDE_BIN="$(find_bin claude)"
CODEX_BIN="$(find_bin codex)"

if [[ -z "$NODE_BIN" ]]; then
  echo "✗ node 를 찾을 수 없습니다. Node.js 18+ 를 설치한 뒤 다시 실행하세요." >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "✗ Node.js 18 이상이 필요합니다 (현재 $("$NODE_BIN" --version))." >&2
  exit 1
fi
echo "• node   : $NODE_BIN ($("$NODE_BIN" --version))"
echo "• claude : ${CLAUDE_BIN:-(없음 — Claude 백엔드 사용 불가)}"
echo "• codex  : ${CODEX_BIN:-(없음 — Codex 백엔드 사용 불가)}"
for b in "$NODE_BIN" "$CLAUDE_BIN" "$CODEX_BIN"; do
  case "$b" in
    *"/.nvm/"*|*"/.asdf/"*|*"/.volta/"*|*"/mise/"*|*"/.fnm/"*|*"/.local/share/fnm/"*)
      echo "⚠ $b 는 버전 관리자 경로입니다. 그 버전을 지우면 브리지가 멈추니, 버전을 바꾼 뒤에는 이 스크립트를 다시 실행하세요." >&2 ;;
  esac
done
if [[ -z "$CLAUDE_BIN" && -z "$CODEX_BIN" ]]; then
  echo "⚠ claude, codex CLI 를 모두 찾지 못했습니다. 설치 후 이 스크립트를 다시 실행하세요." >&2
fi

mkdir -p "$INSTALL_DIR"
cp "$REPO_DIR/host/host.js" "$REPO_DIR/host/mcp-server.js" "$REPO_DIR/host/agent-tools.js" "$REPO_DIR/host/pyfig.js" "$INSTALL_DIR/"

# Python for the figure feature: the first one that can import matplotlib (or a private venv).
has_mpl() { (PATH="$USER_PATH"; perl -e 'alarm 30; exec @ARGV' "$1" -c 'import matplotlib, numpy' >/dev/null 2>&1); }
PY_BIN=""
PY_ANY=""
VENV="$INSTALL_DIR/pyenv"
if [[ -n "${OLAI_PYTHON:-}" ]]; then
  PY_BIN="$OLAI_PYTHON"
elif [[ -x "$VENV/bin/python" ]] && has_mpl "$VENV/bin/python"; then
  PY_BIN="$VENV/bin/python"
else
  for c in python3 python3.14 python3.13 python3.12 python3.11 python3.10 python3.9 /usr/bin/python3 \
           "$HOME/miniforge3/bin/python" "$HOME/miniconda3/bin/python" "$HOME/anaconda3/bin/python"; do
    if [[ "$c" == /* ]]; then [[ -x "$c" ]] && b="$c" || b=""; else b="$(find_bin "$c")"; fi
    [[ -n "$b" ]] || continue
    if has_mpl "$b"; then PY_BIN="$b"; break; fi
    if [[ -z "$PY_ANY" ]] && (PATH="$USER_PATH"; "$b" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null); then PY_ANY="$b"; fi
  done
fi
if [[ -z "$PY_BIN" && "$WITH_MPL" -eq 1 ]]; then
  if [[ -n "$PY_ANY" ]]; then
    echo "• 그림 기능용 Python 환경을 만듭니다: $VENV (matplotlib, numpy 설치 중…)"
    if (PATH="$USER_PATH"; "$PY_ANY" -m venv "$VENV" && "$VENV/bin/python" -m pip install --quiet --disable-pip-version-check matplotlib numpy); then
      PY_BIN="$VENV/bin/python"
    else
      echo "⚠ matplotlib 설치에 실패했습니다. 네트워크를 확인하거나 직접 설치하세요." >&2
    fi
  else
    echo "⚠ Python 3.9+ 를 찾지 못해 그림 기능 환경을 만들 수 없습니다." >&2
  fi
fi
if [[ -n "$PY_BIN" ]]; then
  echo "• python : $PY_BIN ($(PATH="$USER_PATH" "$PY_BIN" -c 'import sys, matplotlib; print(sys.version.split()[0], "· matplotlib", matplotlib.__version__)' 2>/dev/null || echo '?'))"
else
  PY_BIN="${PY_ANY:-python3}"
  echo "• python : ${PY_ANY:-(없음)} — matplotlib 없음. 그림 기능을 쓰려면: ./scripts/install-host.sh --with-matplotlib"
fi

# config.json (JSON-encoded by node so odd characters in paths are safe). Keys the user added by hand
# (claudeExtraArgs, codexExtraArgs, s2ApiKey, webDomains, keepApiKeyEnv, pythonSandbox) are preserved.
"$NODE_BIN" -e '
const fs = require("fs");
const [file, claudePath, codexPath, p, pythonPath] = process.argv.slice(1);
let prev = {};
try { prev = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
fs.writeFileSync(file, JSON.stringify({
  ...prev,
  claudePath: claudePath || "claude",
  codexPath: codexPath || "codex",
  pythonPath: pythonPath || "python3",
  path: p,
  installedAt: new Date().toISOString(),
}, null, 2) + "\n", { mode: 0o600 });
' "$INSTALL_DIR/config.json" "$CLAUDE_BIN" "$CODEX_BIN" "$USER_PATH" "$PY_BIN"
echo "• PATH   : $(printf '%s' "$USER_PATH" | cut -c1-120)…"

LAUNCHER="$INSTALL_DIR/run-host.sh"
{
  echo '#!/bin/bash'
  echo '# Generated by scripts/install-host.sh — do not edit; re-run the installer instead.'
  printf 'export PATH=%q\n' "$USER_PATH"
  printf 'exec %q %q "$@"\n' "$NODE_BIN" "$INSTALL_DIR/host.js"
} > "$LAUNCHER"
chmod 755 "$LAUNCHER"

# Native messaging manifest, written into every Chromium-family browser that is present.
if [[ "$OS" == "Darwin" ]]; then
  BASE="$HOME/Library/Application Support"
  BROWSER_DIRS=(
    "$BASE/Google/Chrome"
    "$BASE/Google/Chrome Beta"
    "$BASE/Google/Chrome Canary"
    "$BASE/Google/Chrome Dev"
    "$BASE/Google/Chrome for Testing"
    "$BASE/Chromium"
    "$BASE/BraveSoftware/Brave-Browser"
    "$BASE/Microsoft Edge"
    "$BASE/Vivaldi"
    "$BASE/Arc/User Data"
  )
else
  BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
  BROWSER_DIRS=(
    "$BASE/google-chrome"
    "$BASE/google-chrome-beta"
    "$BASE/google-chrome-unstable"
    "$BASE/chromium"
    "$BASE/BraveSoftware/Brave-Browser"
    "$BASE/microsoft-edge"
    "$BASE/vivaldi"
    "$HOME/snap/chromium/common/chromium"
    "$HOME/.var/app/com.google.Chrome/config/google-chrome"
    "$HOME/.var/app/org.chromium.Chromium/config/chromium"
    "$HOME/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"
  )
fi

installed=0
for dir in "${BROWSER_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  target="$dir/NativeMessagingHosts"
  mkdir -p "$target"
  "$NODE_BIN" -e '
const [file, name, launcher, extId] = process.argv.slice(1);
require("fs").writeFileSync(file, JSON.stringify({
  name,
  description: "Overleaf AI bridge to the local Claude Code / Codex CLI",
  path: launcher,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extId}/`],
}, null, 2) + "\n");
' "$target/$HOST_NAME.json" "$HOST_NAME" "$LAUNCHER" "$EXT_ID"
  echo "✓ $target/$HOST_NAME.json"
  installed=$((installed + 1))
done

if [[ "$installed" -eq 0 ]]; then
  echo "✗ Chromium 계열 브라우저 프로필 폴더를 찾지 못했습니다. 브라우저를 한 번 실행한 뒤 다시 시도하세요." >&2
  exit 1
fi

echo
echo "설치 완료. 호스트 위치: $INSTALL_DIR"
echo "확장 ID: $EXT_ID"
echo "브라우저의 확장 프로그램 페이지에서 'Overleaf AI' 를 새로고침(⟳)하면 적용됩니다."
