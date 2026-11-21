#!/bin/sh
# Build, sign on asus-arch (tizen-cli + this app's own author cert), install on the TV and launch it.
# NOLAUNCH=1 skips the launch.
# The TV's Developer Mode only accepts sdb from its developer IP (asus-arch, 192.168.0.2).
# This TV rejects in-place updates (error 118): REINSTALL=1 uninstalls first, which also
# wipes the app's saved data (favourites, cached playlist).
set -eu
REINSTALL=${REINSTALL:-0}
cd "$(dirname "$0")/.."
HOST=${HOST:-dk@asus-arch.local}
TV=${TV:-192.168.0.20:26101}
tools/build.sh >/dev/null
v=$(sed -n 's/.*id="http[^"]*" version="\([0-9.]*\)".*/\1/p' app/config.xml)
scp -q build/M3UPTTV.wgt "$HOST:/tmp/M3UPTTV-$v.wgt"
ssh -o BatchMode=yes "$HOST" "set -e
REINSTALL=$REINSTALL
NOLAUNCH=${NOLAUNCH:-0}
K=~/.local/share/m3upt-tv-signing
tizen-cli build -t wgt -o /tmp/M3UPTTV-$v-signed.wgt --author \$K/author.p12 --authorPwd \"\$(cat \$K/password.txt)\" -p public /tmp/M3UPTTV-$v.wgt | tail -1
sdb connect $TV >/dev/null
if [ "${REINSTALL:-0}" = 1 ]; then sdb -s $TV shell 0 vd_appuninstall M3uptTvApp | grep -E 'uninstall (completed|failed)' || true; fi
F=/opt/usr/apps/tmp/M3UPTTV-\$(date +%s).wgt   # fresh staging name each time
sdb -s $TV push /tmp/M3UPTTV-$v-signed.wgt \$F | tail -1
sdb -s $TV shell 0 vd_appinstall M3uptTvApp \$F | grep -E 'install (completed|failed)'
rm -f /tmp/M3UPTTV-$v.wgt /tmp/M3UPTTV-$v-signed.wgt
[ \"\$NOLAUNCH\" = 1 ] || sdb -s $TV shell 0 was_execute M3uptTvApp.M3UPTTV | grep -E 'launch(ed| failed)' || true"
