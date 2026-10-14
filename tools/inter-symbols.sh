#!/bin/sh
# Builds the Inter symbols subset that Copy to Figma draws arrows and UI symbols from (decision 0041).
# The fontsource files have no arrows. Needs curl, unzip and fontTools (`pip install fonttools`).
set -eu

VERSION=4.1
RANGE="U+2190-21FF,U+2200-22FF,U+2300-23FF,U+25A0-25FF,U+2600-26FF,U+2700-27BF"
OUT="$(cd "$(dirname "$0")/.." && pwd)/src/mainview/lib/fonts"
WORK="$(mktemp -d)"

curl -sSL -o "$WORK/inter.zip" "https://github.com/rsms/inter/releases/download/v$VERSION/Inter-$VERSION.zip"
unzip -q "$WORK/inter.zip" 'extras/ttf/*' -d "$WORK"

for pair in 400:Regular 500:Medium 600:SemiBold 700:Bold; do
	pyftsubset "$WORK/extras/ttf/Inter-${pair#*:}.ttf" --unicodes="$RANGE" --flavor=woff --no-hinting \
		--layout-features='' --drop-tables+=GSUB,GPOS,GDEF,STAT,kern \
		--output-file="$OUT/inter-symbols-${pair%%:*}-normal.woff"
done

rm -rf "$WORK"
