#!/bin/bash
# Instala una nueva versión de Singularity.app desde un DMG, esperando a que la app se
# cierre, montando el DMG, copiando la nueva app, intercambiándola con la antigua,
# quitando la cuarentena y reabriendo la app. Si falla, mantiene la versión anterior y
# vuelve a abrir la app. Registra el proceso en ~/Library/Logs/Singularity/update.log.
set -uo pipefail

PID="$1"
DMG="$2"
APP="$3"
LOG_DIR="$HOME/Library/Logs/Singularity"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/update.log" 2>&1
echo "== $(date) actualizando $APP desde $DMG"

MNT=""
finish() {
  local code=$?
  if [ -n "$MNT" ]; then
    hdiutil detach -quiet "$MNT" 2>/dev/null
    rmdir "$MNT" 2>/dev/null
  fi
  rm -f "$DMG"
  [ "$code" -ne 0 ] && echo "falló con código $code"
  open "$APP"
}
trap finish EXIT

for _ in $(seq 1 150); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.2
done

MNT="$(mktemp -d /tmp/singularity-update.XXXXXX)"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" "$DMG" || exit 1
NEW="$(find "$MNT" -maxdepth 1 -name '*.app' -print -quit)"
[ -n "$NEW" ] || exit 1

STAGE="$APP.nueva"
rm -rf "$STAGE"
ditto "$NEW" "$STAGE" || exit 1
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null
rm -rf "$APP.anterior"
mv "$APP" "$APP.anterior" || exit 1
if ! mv "$STAGE" "$APP"; then
  mv "$APP.anterior" "$APP"
  exit 1
fi
rm -rf "$APP.anterior"
echo "instalada"
