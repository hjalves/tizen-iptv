#!/bin/sh
# Build build/M3UPTTV.wgt.
#   tools/build.sh             unsigned package (installs on this TV in Developer Mode)
#   tools/build.sh <profile>   signed with Tizen Studio's CLI and the named certificate profile
set -eu
cd "$(dirname "$0")/.."
rm -rf build && mkdir -p build
node test/es5-check.js
node test/m3u.test.js
if [ $# -ge 1 ]; then
  command -v tizen >/dev/null || { echo "tizen CLI not found (Tizen Studio: tools/ide/bin)"; exit 1; }
  cp -r app build/src
  tizen package -t wgt -s "$1" -- build/src -o build
  mv build/*.wgt build/M3UPTTV.wgt 2>/dev/null || true
  rm -rf build/src
else
  (cd app && zip -qr -X ../build/M3UPTTV.wgt .)
fi
ls -l build/M3UPTTV.wgt
