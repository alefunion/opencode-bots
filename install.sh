#!/usr/bin/env bash
# Installs Bots for OpenCode, and the OpenCode CLI first if it is missing.
#
#   curl -fsSL https://raw.githubusercontent.com/alefunion/opencode-bots/main/install.sh | bash

set -euo pipefail

PLUGIN="github:alefunion/opencode-bots"
DESKTOP_URL="https://opencode.ai/download"

bold=$'\033[1m'
dim=$'\033[2m'
reset=$'\033[0m'
[ -t 1 ] || { bold=""; dim=""; reset=""; }

say() { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s%s%s\n' "$dim" "$reset" "$bold" "$*" "$reset"; }
fail() { printf '\nError: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *) fail "Bots for OpenCode runs on macOS and Linux only." ;;
esac

# OpenCode Desktop bundles the CLI, but does not always put it on PATH.
find_opencode() {
  if command -v opencode >/dev/null 2>&1; then
    command -v opencode
    return
  fi
  for candidate in \
    "$HOME/.opencode/bin/opencode" \
    "/Applications/OpenCode.app/Contents/Resources/opencode-cli" \
    "$HOME/Applications/OpenCode.app/Contents/Resources/opencode-cli"; do
    if [ -x "$candidate" ]; then
      say "$candidate"
      return
    fi
  done
  return 1
}

step "Looking for OpenCode"
if ! opencode=$(find_opencode); then
  say "OpenCode is not installed. Installing the OpenCode CLI from opencode.ai…"
  curl -fsSL https://opencode.ai/v2/install | bash
  opencode=$(find_opencode) || fail "OpenCode installed, but this shell can't find it yet. Open a new terminal and run this script again."
fi
say "Found $("$opencode" --version 2>/dev/null || say OpenCode) at $opencode"

step "Installing Bots for OpenCode"
"$opencode" plugin add "$PLUGIN"

step "Checking for OpenCode Desktop"
desktop=""
if [ "$os" = macos ]; then
  for app in "/Applications/OpenCode.app" "$HOME/Applications/OpenCode.app"; do
    [ -d "$app" ] && desktop="$app"
  done
fi

if [ -n "$desktop" ]; then
  say "Found $desktop"
elif [ "$os" = macos ]; then
  say "OpenCode Desktop is not installed. You need it to pair your phone."
  say "Download it from $DESKTOP_URL"
else
  say "You need OpenCode Desktop to pair your phone."
  say "If you don't have it yet, download it from $DESKTOP_URL"
fi

cat <<EOF

${bold}Done!${reset} Your first bot, Chief, is ready.

Next:
  1. Open OpenCode Desktop.
  2. Go to Settings → Bots and click Pair device.
  3. Scan the QR code with your phone.
EOF
