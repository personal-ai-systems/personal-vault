#!/bin/zsh
# Public tunnel for the Personal Vault MCP server.
# Owner: Personal Vault. Renamed from start-ngrok-mcp.sh, which defaulted to the
# Assistant port 8787 while living in the Vault data directory.
set -eu

CONFIG_DIR="${PERSONAL_VAULT_CONFIG_DIR:-$HOME/.config/personal-vault}"
ENV_FILE="${NGROK_ENV_FILE:-$CONFIG_DIR/ngrok.env}"
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

NGROK_BIN="${NGROK_BIN:-/opt/homebrew/bin/ngrok}"
MCP_TARGET="${MCP_TARGET:-http://127.0.0.1:8788}"

if [[ -n "${NGROK_DOMAIN:-}" ]]; then
  exec "$NGROK_BIN" http --domain="$NGROK_DOMAIN" "$MCP_TARGET" --log=stdout
fi
exec "$NGROK_BIN" http "$MCP_TARGET" --log=stdout
