#!/bin/sh
# Refresh the offline copy of the playlist and the logos it references.
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 https://github.com/LITUATUI/M3UPT "$tmp/m3upt"
cp "$tmp/m3upt/M3U/M3UPT.m3u" app/data/M3UPT.m3u
rm -rf app/logos && mkdir -p app/logos
grep -o 'tvg-logo="https://raw.githubusercontent.com/LITUATUI/M3UPT/main/logos/[^"]*"' app/data/M3UPT.m3u \
  | sed 's#.*/logos/##; s#"$##' | sort -u | while read -r f; do
    # Tizen 2.4's installer rejects packages with non-ASCII file names (error 118);
    # such logos are loaded from GitHub at runtime instead.
    case "$f" in *[!A-Za-z0-9._-]*) continue ;; esac
    [ -f "$tmp/m3upt/logos/$f" ] && cp "$tmp/m3upt/logos/$f" app/logos/
  done
echo "playlist: $(grep -c '^#EXTINF' app/data/M3UPT.m3u) entries; logos: $(ls app/logos | wc -l) ($(du -sh app/logos | cut -f1))"
