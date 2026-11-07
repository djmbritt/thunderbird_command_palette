#!/usr/bin/env bash
# Regenerate types/messenger.d.ts from Thunderbird's MV3 ESR schemas plus our
# experiment schema. Dev-only (see "Type checking" in CLAUDE.md).
#
#   tools/update-types.sh [branch]     # default: esr-mv3
set -euo pipefail
cd "$(dirname "$0")/.."

repo=thunderbird/webext-annotated-schemas
branch=${1:-esr-mv3}
sha=$(git ls-remote "https://github.com/$repo" "refs/heads/$branch" | cut -f1)
[ -n "$sha" ] || { echo "branch $branch not found in $repo" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://codeload.github.com/$repo/tar.gz/$sha" | tar xz -C "$tmp"
schemas=$(echo "$tmp"/*/schema-files)
version=$(grep -h -m1 -o '"applicationVersion": *"[^"]*"' "$schemas/folders.json" | cut -d'"' -f4)

node tools/gen-types.mjs types/messenger.d.ts "$schemas" experiments/schema.json \
  --since types/api-since.json \
  --header "Source: github.com/$repo @ $branch $sha (Thunderbird $version)
plus experiments/schema.json (messenger.palette).
The add-on supports Thunderbird 128+: check @since on anything newer."
