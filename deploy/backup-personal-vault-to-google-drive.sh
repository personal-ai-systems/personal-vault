#!/bin/zsh
# Backup the readable Personal Vault data directory to Google Drive.
# Owner: Personal Vault. Lives in git; the data directory holds no code.
set -euo pipefail

VAULT_DIR="${PERSONAL_VAULT_ROOT:-$HOME/personal-vault}"
CONFIG_DIR="${PERSONAL_VAULT_CONFIG_DIR:-$HOME/.config/personal-vault}"
RCLONE_BIN="${RCLONE_BIN:-/opt/homebrew/bin/rclone}"
RCLONE_CONFIG_FILE="${RCLONE_CONFIG_FILE:-$HOME/.config/rclone/rclone.conf}"
RCLONE_REMOTE="${PERSONAL_VAULT_RCLONE_REMOTE:-personal-vault-drive:Personal Vault/Backups}"
ARCHIVE_NAME="personal-vault-latest.zip"
MANIFEST_NAME="personal-vault-latest.md"
TODAY="$(date +%F)"
NOW="$(date '+%Y-%m-%d %H:%M:%S %Z')"
TMP_DIR="$VAULT_DIR/tmp/google-drive-backup"
TMP_ARCHIVE="$TMP_DIR/$ARCHIVE_NAME"
TMP_MANIFEST="$TMP_DIR/$MANIFEST_NAME"
STATE_DIR="$VAULT_DIR/indexes/backup-state"
STATE_FILE="$STATE_DIR/google-drive-last-date.txt"

mkdir -p "$TMP_DIR" "$STATE_DIR" "$VAULT_DIR/logs"

[[ -x "$RCLONE_BIN" ]] || { echo "rclone is not available at $RCLONE_BIN" >&2; exit 1; }
[[ -f "$RCLONE_CONFIG_FILE" ]] || { echo "rclone config is not available at $RCLONE_CONFIG_FILE" >&2; exit 1; }

if [[ "${FORCE_BACKUP:-0}" != "1" && -f "$STATE_FILE" ]] && grep -qx "$TODAY" "$STATE_FILE"; then
  echo "Personal Vault backup already completed for $TODAY."
  exit 0
fi

rm -f "$TMP_ARCHIVE" "$TMP_MANIFEST"
trap 'rm -f "$TMP_ARCHIVE" "$TMP_MANIFEST"' EXIT

PARENT_DIR="$(dirname "$VAULT_DIR")"
VAULT_NAME="$(basename "$VAULT_DIR")"

cd "$PARENT_DIR"
/usr/bin/zip -qry "$TMP_ARCHIVE" "$VAULT_NAME" \
  -x "$VAULT_NAME/.DS_Store" \
     "$VAULT_NAME/.env*" \
     "$VAULT_NAME/.git/*" \
     "$VAULT_NAME/.trash/*" \
     "$VAULT_NAME/logs/*" \
     "$VAULT_NAME/tmp/*"

/usr/bin/unzip -tq "$TMP_ARCHIVE" >/dev/null

SHA256="$(/usr/bin/shasum -a 256 "$TMP_ARCHIVE" | /usr/bin/awk '{print $1}')"
SIZE_BYTES="$(/usr/bin/stat -f '%z' "$TMP_ARCHIVE")"

cat > "$TMP_MANIFEST" <<MANIFEST
# Personal Vault Backup

- Backup date: $TODAY
- Created: $NOW
- Source: $VAULT_DIR
- Archive: $ARCHIVE_NAME
- Size: $SIZE_BYTES bytes
- SHA-256: $SHA256

## Included

Readable Vault content: raw captures, structured data, indexes, exports and documentation.

Automation scripts are no longer stored in the Vault directory. They live in the
personal-vault repository under deploy/ and are versioned there.

## Excluded

Runtime logs, temporary files, recoverable trash, Git internals, macOS metadata,
and local environment secrets.

## Restore

Download the ZIP, verify the SHA-256 value above, and extract it into a temporary
directory before replacing any live Vault data.
MANIFEST

"$RCLONE_BIN" --config "$RCLONE_CONFIG_FILE" --log-level ERROR \
  copyto "$TMP_ARCHIVE" "$RCLONE_REMOTE/$ARCHIVE_NAME" --checksum --drive-chunk-size 32M
"$RCLONE_BIN" --config "$RCLONE_CONFIG_FILE" --log-level ERROR \
  copyto "$TMP_MANIFEST" "$RCLONE_REMOTE/$MANIFEST_NAME" --checksum

REMOTE_SIZE="$("$RCLONE_BIN" --config "$RCLONE_CONFIG_FILE" --log-level ERROR \
  lsl "$RCLONE_REMOTE/$ARCHIVE_NAME" | /usr/bin/awk 'NR == 1 {print $1}')"
if [[ "$REMOTE_SIZE" != "$SIZE_BYTES" ]]; then
  echo "Google Drive size verification failed: local=$SIZE_BYTES remote=${REMOTE_SIZE:-missing}" >&2
  exit 1
fi

STATE_TMP="$STATE_FILE.tmp.$$"
printf '%s\n' "$TODAY" > "$STATE_TMP"
/bin/mv -f "$STATE_TMP" "$STATE_FILE"

echo "Backup uploaded: $RCLONE_REMOTE/$ARCHIVE_NAME ($SIZE_BYTES bytes, sha256 $SHA256)"
