#!/usr/bin/env bash
# Build the two .xpi files:
#   command-palette-<version>.xpi         the palette (addons.thunderbird.net)
#   command-palette-extras-<version>.xpi  the Extras companion with the
#                                         experiment (self-hosted, GitHub releases)
# Output is written one directory up from the project root so the .xpi files
# are never zipped into a future build.

set -euo pipefail

cd "$(dirname "$0")"

version() { grep -oP '"version"\s*:\s*"\K[^"]+' "$1"; }

PALETTE_OUT="../command-palette-$(version manifest.json).xpi"
EXTRAS_OUT="../command-palette-extras-$(version companion/manifest.json).xpi"

rm -f "${PALETTE_OUT}" "${EXTRAS_OUT}"

# manifest.json must sit at the zip root. -FS = filesync semantics on re-runs.
# Exclude dev-only files, the companion and any stray previous builds.
zip -r -FS "${PALETTE_OUT}" . \
  -x "*.git*" \
     ".claude/*" \
     "node_modules/*" \
     "*.DS_Store" \
     "CLAUDE.md" \
     "package.sh" \
     "companion/*" \
     "tests/*" \
     "e2e/*" \
     "store/*" \
     "tools/*" \
     "icons/icon.svg" \
     "types/*" \
     "package.json" \
     "package-lock.json" \
     "tsconfig*.json" \
     "*.xpi" \
     "build/*" \
     "dist/*" >/dev/null

# The companion: its own directory, plus the shared PNG icons (companion/icons
# is a symlink to ../icons, which zip follows). updates.json is served from
# the repository, not shipped.
(cd companion && zip -r -FS "../${EXTRAS_OUT}" . \
  -x "*.DS_Store" \
     "updates.json" \
     "icons/icon.svg" >/dev/null)

for out in "${PALETTE_OUT}" "${EXTRAS_OUT}"; do
  echo "Built:  $(realpath "${out}") ($(du -h "${out}" | cut -f1))"
done
echo
echo "Upload command-palette-*.xpi to addons.thunderbird.net."
echo "Attach command-palette-extras-*.xpi to a GitHub release tagged"
echo "extras-v<version>, and add that version to companion/updates.json."
echo "(Thunderbird doesn't require add-ons to be signed.)"
