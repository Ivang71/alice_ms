#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_ROOT"

if [ ! -f "$APP_ROOT/.env" ]; then
  echo ".env not found in $APP_ROOT" >&2
  exit 1
fi

set -a
. "$APP_ROOT/.env"
set +a

DOMAIN="${DOMAIN:-}"
PORT="${PORT:-3000}"

if [ -z "$DOMAIN" ]; then
  echo "DOMAIN is not set (export DOMAIN or put it into .env)" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed; run ./setup.sh or install Node.js first" >&2
  exit 1
fi

if ! command -v yarn >/dev/null 2>&1; then
  echo "yarn is not installed; run ./setup.sh or install yarn first" >&2
  exit 1
fi

yarn

if ! command -v caddy >/dev/null 2>&1; then
  sudo apt update -y
  sudo DEBIAN_FRONTEND=noninteractive apt install -y caddy
fi

CADDYFILE="/etc/caddy/Caddyfile"

if [ -f "$CADDYFILE" ] && grep -q "$DOMAIN" "$CADDYFILE"; then
  :
else
  TMP_CADDY="$(mktemp)"
  if [ -f "$CADDYFILE" ]; then
    sudo cp "$CADDYFILE" "$TMP_CADDY"
  fi
  {
    if [ -f "$TMP_CADDY" ]; then
      cat "$TMP_CADDY"
      echo
    fi
    echo "$DOMAIN {"
    echo "  reverse_proxy 127.0.0.1:$PORT"
    echo "}"
  } | sudo tee "$CADDYFILE" >/dev/null
  rm -f "$TMP_CADDY"
fi

sudo systemctl enable --now caddy

sudo systemctl reload caddy || true

echo "Dependencies installed with yarn"
echo "Caddy is configured for https://$DOMAIN -> http://127.0.0.1:$PORT"
echo "Run the app with: PORT=$PORT yarn prod"


