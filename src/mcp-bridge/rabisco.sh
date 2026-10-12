#!/bin/sh
self="$0"

while [ -L "$self" ]; do
	link="$(readlink "$self")"
	case "$link" in
	/*) self="$link" ;;
	*) self="$(dirname "$self")/$link" ;;
	esac
done

dir="$(cd "$(dirname "$self")" && pwd)"
exec "$dir/../../../MacOS/cottontail" "$dir/rabisco.mjs" "$@"
