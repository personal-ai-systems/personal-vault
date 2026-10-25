#!/bin/zsh
# Render the LaunchAgent templates in deploy/launchd/ and install them.
#
#   ./deploy/install-launchd.sh              install and (re)load
#   ./deploy/install-launchd.sh --dry-run    render to stdout only
#
# Machine-specific values are read from ~/.config/personal-vault/settings.env,
# never from the Vault data directory and never from git.
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_ROOT="${PERSONAL_VAULT_ROOT:-$HOME/personal-vault}"
CONFIG_DIR="${PERSONAL_VAULT_CONFIG_DIR:-$HOME/.config/personal-vault}"
SETTINGS="$CONFIG_DIR/settings.env"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

[[ -f "$SETTINGS" ]] && source "$SETTINGS"
: "${PUBLIC_BASE_URL:=}"
: "${GOOGLE_AUTH:=false}"
: "${GOOGLE_ALLOWED_EMAILS:=}"
: "${NODE_BIN:=$(command -v node)}"

NODE_DIR="$(dirname "$NODE_BIN")"

render() {
  python3 - "$1" \
    "__REPO_DIR__=$REPO_DIR" \
    "__VAULT_ROOT__=$VAULT_ROOT" \
    "__CONFIG_DIR__=$CONFIG_DIR" \
    "__NODE_BIN__=$NODE_BIN" \
    "__NODE_DIR__=$NODE_DIR" \
    "__PUBLIC_BASE_URL__=$PUBLIC_BASE_URL" \
    "__GOOGLE_AUTH__=$GOOGLE_AUTH" \
    "__GOOGLE_ALLOWED_EMAILS__=$GOOGLE_ALLOWED_EMAILS" <<'PY'
import sys
path, *pairs = sys.argv[1:]
text = open(path, encoding="utf-8").read()
for pair in pairs:
    key, _, value = pair.partition("=")
    text = text.replace(key, value)
open("/dev/stdout", "w", encoding="utf-8").write(text)
PY
}

mkdir -p "$LAUNCH_AGENTS"
rc=0

for template in "$REPO_DIR"/deploy/launchd/*.plist.template; do
  name="$(basename "$template" .template)"
  label="${name%.plist}"
  target="$LAUNCH_AGENTS/$name"
  rendered="$(render "$template")"

  if [[ "$DRY_RUN" == "1" ]]; then
    print -r -- "===== $target ====="
    print -r -- "$rendered"
    continue
  fi

  # Validate before touching the live plist: a broken render must never replace
  # an agent that is currently working.
  tmp_plist="$(mktemp -t rendered-plist)"
  print -r -- "$rendered" > "$tmp_plist"
  if ! /usr/libexec/PlistBuddy -c "Print :Label" "$tmp_plist" >/dev/null 2>&1; then
    echo "rendered plist is invalid, keeping the existing agent: $target" >&2
    rm -f "$tmp_plist"
    rc=1
    continue
  fi
  /bin/mv -f "$tmp_plist" "$target"

  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  if launchctl bootstrap "gui/$(id -u)" "$target" >/dev/null 2>&1; then
    echo "installed $label"
  else
    echo "FAILED to load $label" >&2; rc=1
  fi
done

exit $rc
