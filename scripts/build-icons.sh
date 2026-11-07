#!/bin/sh
# Renders the Home Screen and favicon assets from the source logos.
# Needs librsvg (`brew install librsvg`). Run from the package root after
# changing public/logo.svg or public/mark.svg.
set -eu
cd "$(dirname "$0")/.."

render() { # input.svg size output.png
  rsvg-convert -w "$2" -h "$2" -o "$3" "$1"
}

for size in 192 512; do
  render public/logo.svg "$size" "web/src/icons/icon-$size.png"
  render public/logo.svg "$size" "web/src/icons/maskable-$size.png"
done
render public/logo.svg 180 web/src/icons/apple-touch-icon.png

# The favicon and the in-app mark are the plain SVG, served as-is.
cp public/mark.svg web/src/favicon.svg
echo "icons rebuilt"
