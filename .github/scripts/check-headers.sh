#!/usr/bin/env bash
# spec 008 RF-22 — comprueba que una URL responde con todas las cabeceras indicadas (línea completa, sin distinguir
# mayúsculas) y, opcionalmente, que ninguna cabecera "prohibida" aparece.
# Uso: check-headers.sh <url> [cabecera ...] [-- <nombre-de-cabecera-prohibida> ...]
#   check-headers.sh http://localhost:5173/ 'x-frame-options: DENY' -- x-powered-by
set -euo pipefail

url=$1; shift
required=(); forbidden=(); target=required
for arg in "$@"; do
  if [ "$arg" = "--" ]; then target=forbidden; continue; fi
  if [ "$target" = required ]; then required+=("$arg"); else forbidden+=("$arg"); fi
done

headers=$(curl --silent --show-error --head "$url" | tr -d '\r')
status=0

for expected in "${required[@]}"; do
  if ! grep -iqx -- "$expected" <<<"$headers"; then echo "FALTA «$expected» en $url"; status=1; fi
done
for name in "${forbidden[@]}"; do
  if grep -iq -- "^$name:" <<<"$headers"; then echo "SOBRA «$name» en $url"; status=1; fi
done

if [ "$status" -ne 0 ]; then echo "--- cabeceras recibidas de $url:"; echo "$headers"; fi
exit "$status"
