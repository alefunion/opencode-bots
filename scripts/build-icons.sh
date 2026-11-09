#!/bin/sh
# Compresses the logo SVGs and renders the Home Screen and favicon assets from
# them. Needs librsvg (`brew install librsvg`) and Bun (for SVGO). Run from the
# package root after changing a file in public/.
set -eu
cd "$(dirname "$0")/.."

svgo() { bunx svgo --config scripts/svgo.config.mjs --quiet "$@"; }
svgo public/mark.svg public/mark-light.svg public/mark-dark.svg
# The app icon's opacities need two decimal places.
svgo --precision 2 public/logo.svg

# The app icon also serves as the maskable icon, as OpenCode's own does.
icon() { # size output.png
  rsvg-convert -w "$1" -h "$1" -o "$2" public/logo.svg
}

icon 192 web/src/icons/icon-192.png
icon 512 web/src/icons/icon-512.png
icon 180 web/src/icons/apple-touch-icon.png

# The favicon is the theme-aware mark, centred on a square canvas.
sed -e 's/width="16"/width="20"/' -e 's/viewBox="0 0 16 20"/viewBox="-2 0 20 20"/' \
  public/mark.svg >web/src/favicon.svg
echo "icons rebuilt"
