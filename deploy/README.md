# Personal Vault deploy

Everything here belongs to Personal Vault and is versioned with it. The Vault data
directory (`PERSONAL_VAULT_ROOT`, default `~/personal-vault`) holds only files the
user owns: Markdown, attachments, indexes, logs. No executable code lives there.

## Files

| File | Purpose |
|---|---|
| `backup-personal-vault-to-google-drive.sh` | Zip the data directory, verify the archive, upload to Google Drive with a size check |
| `check-vault-health.sh` | Health check for this Vault MCP server only |
| `start-vault-ngrok.sh` | Public tunnel to the Vault MCP on port 8788 |
| `install-launchd.sh` | Render `launchd/*.template` and install the LaunchAgents |
| `launchd/*.plist.template` | Templates with `__PLACEHOLDER__` values |

## Configuration

Machine settings and secrets live in `~/.config/personal-vault/` (override with
`PERSONAL_VAULT_CONFIG_DIR`):

| File | Contents |
|---|---|
| `settings.env` | `PUBLIC_BASE_URL`, `GOOGLE_AUTH`, `GOOGLE_ALLOWED_EMAILS` |
| `ngrok.env` | `NGROK_DOMAIN`, `MCP_TARGET` |
| `mcp-service-token` | Service token used by MCP clients |

None of these are in git and none are inside the data directory.

## Install

```bash
./deploy/install-launchd.sh --dry-run   # render only
./deploy/install-launchd.sh             # write to ~/Library/LaunchAgents and load
```

## Boundary

Vault health asserts Vault tools (`vault_files_list`, `vault_files_create`,
`vault_files_search`). It deliberately does not assert `capture_note` or
`get_today_plan`: those are Assistant-shaped tools that do not belong to this
service's contract.

Backups of Assistant runtime, dashboard logs and Health Connect imports are not
this repository's responsibility. See `personal-dashboard/deploy/`.
