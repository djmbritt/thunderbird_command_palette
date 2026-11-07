#!/usr/bin/env bash
# Build the Thunderbird Command Palette .xpi.
# Output is written one directory up from the project root so the .xpi itself
# is never zipped into a future build.

set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(grep -oP '"version"\s*:\s*"\K[^"]+' manifest.json)
NAME="command-palette-${VERSION}.xpi"
OUT_PATH="../${NAME}"

rm -f "${OUT_PATH}"

# manifest.json must sit at the zip root. -FS = filesync semantics on re-runs.
# Exclude dev-only files and any stray previous builds.
zip -r -FS "${OUT_PATH}" . \
  -x "*.git*" \
     ".claude/*" \
     "node_modules/*" \
     "*.DS_Store" \
     "CLAUDE.md" \
     "package.sh" \
     "tests/*" \
     "e2e/*" \
     "store/*" \
     "tools/*" \
     "types/*" \
     "package.json" \
     "package-lock.json" \
     "tsconfig*.json" \
     "*.xpi" \
     "build/*" \
     "dist/*" >/dev/null

ABS_PATH="$(realpath "${OUT_PATH}")"
SIZE="$(du -h "${OUT_PATH}" | cut -f1)"

echo "Built:  ${ABS_PATH}"
echo "Size:   ${SIZE}"
echo
echo "Install: Tools → Add-ons and Themes → ⚙ → Install Add-on From File…"
echo "         and pick ${ABS_PATH}"
echo "(Thunderbird doesn't require add-ons to be signed.)"
