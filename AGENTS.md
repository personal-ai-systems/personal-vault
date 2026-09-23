# Personal Vault

## The idea

Personal Vault is a normal folder that belongs to its user.

The files in that folder are the product. A person must be able to open the folder in Finder, read a note in any Markdown editor, move it, back it up and understand what is there without an app or an account.

The API and MCP server are a helpful doorway to those same files. They must not create a second hidden storage system.

## Keep it simple

- Markdown notes and normal attachments are the source of truth.
- Keep meaningful names and folders such as `raw/2026/08/` and `structured/`.
- Return readable paths from the API, never internal names.
- Save attachments beside their Markdown file in a visible `.assets` folder.
- Search the files themselves. A temporary cache is optional and must never be required to read the Vault.
- Archive by moving a file into the visible `archive/` folder. Do not permanently delete user files during normal use.
- Personal Vault stores files. Personal Assistant decides what Health, Today, Planner or projects mean.

## Before changing code

1. Test only against a temporary folder.
2. Do not touch a real Vault unless the user explicitly asks.
3. Keep the public API small: list, read, create, update, search, attach, archive and restore.
4. Do not introduce hidden storage formats, internal names, or application-specific concepts.
5. Do not commit personal files, tokens, backups or logs.

## Scope of this chat

This conversation is for **Personal Vault development only**: this repository
(file API, MCP server, scripts, docs) and the paired `personal-vault-ui`
desktop app.

Out of scope here — keep it in a separate chat:

- Moltis gateway, its web UI, sessions, channels, cron jobs, provider/routing logs.
- Any other project that is not Personal Vault.

Rules for this chat:

1. Investigate Personal Vault first: repository files, `git status`, tests, the
   Vault MCP service and the desktop app.
2. Never answer a Personal Vault question with Moltis runtime evidence, and never
   report Moltis connectivity as Personal Vault status.
3. Personal Vault availability is independent of Moltis. The only shared surface
   is that a client may call the Vault MCP endpoint.
4. Treat the real Vault (`PERSONAL_VAULT_ROOT`, default `~/personal-vault`) as
   read-only unless Kirill explicitly asks for a change.

## Local runtime facts

Verify these before repeating them; recorded 2026-09-20.

- The Vault MCP server runs as a launchd service `com.kirill.personal-vault.mcp`
  (`~/Library/LaunchAgents/com.kirill.personal-vault.mcp.plist`, `KeepAlive=true`).
- It executes this repository's working tree, bound to `127.0.0.1:8788`, path
  `/mcp`, with `PERSONAL_VAULT_ROOT=/Users/kirill/personal-vault`.
- Because that service holds port 8788, a second manual start
  (`npm run mcp:vault`) fails with `EADDRINUSE`. Pass a different `MCP_PORT` or
  stop the service first.
- Status endpoint: `curl -s http://127.0.0.1:8788/status`. Periodic health log:
  `$PERSONAL_VAULT_ROOT/logs/personal-vault-mcp-health.log`.
- The desktop app is packaged in the sibling `personal-vault-ui`; see
  `docs/desktop-integration.md` and `../personal-vault-ui/docs/desktop-macos.md`.
- Launching either server directly (`node mcp/personal-vault-server.mjs`) is not
  the supported way to start the product. Prefer the service or the desktop app.
