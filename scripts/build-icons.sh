#!/bin/sh
# Renders the Home Screen and favicon assets from the mark.
# Needs librsvg (`brew install librsvg`). Run from the package root after
# changing the mark in public/.
set -eu
cd "$(dirname "$0")/.."

# The mark is 5 × 5 strokes. Each size gets a whole-pixel stroke and an even
# offset, so every edge lands on a pixel, with at least two strokes of clear
# space and the mark inside the central 80% maskable circle.
icon() { # size stroke output.png
  offset=$((($1 - 5 * $2) / 2))
  sed -e "s/512/$1/g" -e "s/translate(116 116) scale(56)/translate($offset $offset) scale($2)/" \
    public/logo.svg | rsvg-convert -w "$1" -h "$1" -o "$3"
}

icon 192 20 web/src/icons/icon-192.png
icon 192 20 web/src/icons/maskable-192.png
icon 512 56 web/src/icons/icon-512.png
icon 512 56 web/src/icons/maskable-512.png
icon 180 18 web/src/icons/apple-touch-icon.png

# The favicon is the plain SVG, which follows the system light or dark mode.
cp public/mark.svg web/src/favicon.svg
echo "icons rebuilt"
