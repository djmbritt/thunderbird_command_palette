#!/usr/bin/env bash
# Render icons/icon.svg (the source) to the PNG sizes the manifest uses.
# Rerun after changing the SVG. Needs rsvg-convert (librsvg).
set -euo pipefail
cd "$(dirname "$0")/../icons"
for size in 16 32 48 64 96 128; do
  rsvg-convert -w "$size" -h "$size" icon.svg -o "icon-$size.png"
done
ls -1 icon-*.png
