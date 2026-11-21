#!/bin/sh
# Download Tizen's x86-64 sdb plus a minimal x86-64 glibc/libstdc++ sysroot so that
# tools/sdb can run it on an aarch64 host through qemu-user (needs qemu-x86_64).
set -eu
cd "$(dirname "$0")"
d=sdb-dl; mkdir -p "$d/sysroot"; cd "$d"
curl -sfLO https://download.tizen.org/sdk/tizenstudio/official/binary/sdb_4.2.36_ubuntu-64.zip
unzip -qo sdb_4.2.36_ubuntu-64.zip
mirror=https://geo.mirror.pkgbuild.com/core/os/x86_64
for p in glibc libgcc libstdc++; do
  f=$(curl -sf "$mirror/" | grep -o "\"$(printf %s "$p" | sed 's/+/%2B/g')-[0-9][^\"]*x86_64\.pkg\.tar\.zst\"" | tr -d '"' | head -1)
  curl -sf -o pkg.tzst "$mirror/$f"
  tar --zstd -xf pkg.tzst -C sysroot usr/lib 2>/dev/null || true
done
rm -f pkg.tzst
mkdir -p sysroot/lib64 && ln -sf ../usr/lib/ld-linux-x86-64.so.2 sysroot/lib64/ld-linux-x86-64.so.2
ln -sfn usr/lib sysroot/lib
echo "ok: $(../sdb version)"
