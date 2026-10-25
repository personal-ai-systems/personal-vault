#!/bin/zsh
# Health check for the Personal Vault MCP server only.
# Owner: Personal Vault. Assistant health is checked separately by
# personal-dashboard/deploy/check-assistant-health.sh.
#
# Asserts Vault-owned file tools. It deliberately does NOT assert capture_note or
# get_today_plan: those are Assistant-shaped tools that are being moved out of the
# Vault server, and a Vault health check must not depend on them.
set -u

VAULT_ROOT="${PERSONAL_VAULT_ROOT:-$HOME/personal-vault}"
CONFIG_DIR="${PERSONAL_VAULT_CONFIG_DIR:-$HOME/.config/personal-vault}"
[[ -f "$CONFIG_DIR/settings.env" ]] && source "$CONFIG_DIR/settings.env"
STATUS_FILE="$VAULT_ROOT/indexes/mcp-status.json"
LOG_FILE="$VAULT_ROOT/logs/personal-vault-mcp-health.log"
MCP_LABEL="com.kirill.personal-vault.mcp"
NGROK_LABEL="com.kirill.personal-vault.ngrok"
LOCAL_URL="${LOCAL_MCP_URL:-http://127.0.0.1:8788/mcp}"
PUBLIC_URL="${PUBLIC_MCP_URL:-${PUBLIC_BASE_URL:+$PUBLIC_BASE_URL/mcp}}"
SERVICE_TOKEN="$(cat "$CONFIG_DIR/mcp-service-token" 2>/dev/null || true)"
AUTH_HEADER="Authorization: Bearer ${SERVICE_TOKEN}"

mkdir -p "$VAULT_ROOT/indexes" "$VAULT_ROOT/logs"

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
json_escape() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'; }

mcp_initialize() {
  curl --http1.1 -m 15 -sS -X POST "$1" \
    -H 'Content-Type: application/json' -H "$AUTH_HEADER" \
    -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"vault-healthcheck","version":"1.0"}}}' 2>&1
}

mcp_tools_list() {
  curl --http1.1 -m 15 -sS -X POST "$1" \
    -H 'Content-Type: application/json' -H "$AUTH_HEADER" \
    -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' 2>&1
}

# A Vault server is healthy when it answers initialize and still exposes its own
# file contract.
vault_is_healthy() {
  local url="$1" init_body="$2" tools_body
  printf "%s\n" "$init_body" | grep -q '"serverInfo"' || return 1
  tools_body="$(mcp_tools_list "$url")"
  printf "%s\n" "$tools_body" | grep -q '"vault_files_list"' || return 1
  printf "%s\n" "$tools_body" | grep -q '"vault_files_create"' || return 1
  printf "%s\n" "$tools_body" | grep -q '"vault_files_search"' || return 1
}

restart_agent() { launchctl kickstart -k "gui/$(id -u)/$1" >/dev/null 2>&1 || true; }

now="$(timestamp)"

local_body="$(mcp_initialize "$LOCAL_URL")"
local_ok=false
if vault_is_healthy "$LOCAL_URL" "$local_body"; then
  local_ok=true
else
  restart_agent "$MCP_LABEL"
  sleep 3
  local_body="$(mcp_initialize "$LOCAL_URL")"
  vault_is_healthy "$LOCAL_URL" "$local_body" && local_ok=true
fi

public_ok=null
public_excerpt='""'
if [[ -n "$PUBLIC_URL" ]]; then
  public_body="$(mcp_initialize "$PUBLIC_URL")"
  public_ok=false
  if vault_is_healthy "$PUBLIC_URL" "$public_body"; then
    public_ok=true
  else
    restart_agent "$NGROK_LABEL"
    sleep 5
    public_body="$(mcp_initialize "$PUBLIC_URL")"
    vault_is_healthy "$PUBLIC_URL" "$public_body" && public_ok=true
  fi
  public_excerpt="$(printf "%s\n" "$public_body" | head -c 260 | json_escape)"
fi

local_excerpt="$(printf "%s\n" "$local_body" | head -c 260 | json_escape)"

cat > "$STATUS_FILE" <<JSON
{
  "checkedAt": "$now",
  "service": "personal-vault",
  "localUrl": "$LOCAL_URL",
  "publicUrl": "${PUBLIC_URL:-}",
  "localOk": $local_ok,
  "publicOk": $public_ok,
  "primaryEndpoint": "${PUBLIC_URL:-}",
  "localExcerpt": $local_excerpt,
  "publicExcerpt": $public_excerpt
}
JSON

printf "%s\n" "$now vault localOk=$local_ok publicOk=$public_ok" >> "$LOG_FILE"

[[ "$local_ok" == true ]] || exit 1
[[ "$public_ok" == true || "$public_ok" == null ]] || exit 1
exit 0
