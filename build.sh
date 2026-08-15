#!/usr/bin/env bash
# Package the plugin as an .xpi for distribution.
set -euo pipefail

cd "$(dirname "$0")"

NAME="zotero-selection-search"
VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' manifest.json \
	| head -1 | sed 's/.*"\([^"]*\)"$/\1/')

if [ -z "$VERSION" ]; then
	echo "Could not read version from manifest.json" >&2
	exit 1
fi

OUT="build/${NAME}-${VERSION}.xpi"
rm -rf build
mkdir -p build

# The manifest must sit at the archive root, not inside a folder.
zip -r -FS "$OUT" \
	manifest.json \
	bootstrap.js \
	LICENSE \
	-x '*.DS_Store'

echo "Built $OUT"
