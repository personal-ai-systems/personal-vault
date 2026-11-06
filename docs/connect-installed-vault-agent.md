# Codex: connect the installed Personal Vault

Complete the setup yourself on this Mac. Do not reinstall the app or start a
second Vault server. Expected folder: `/Users/<username>/Personal Vault`.
Registering the local MCP server in Codex and creating one test note are authorized.

1. Find the running process whose path is:
   `/Applications/Personal Vault.app/Contents/Resources/vault/node_modules/personal-vault/mcp/personal-vault-server.mjs`.
   For its PID, run `lsof -nP -a -p PID -iTCP -sTCP:LISTEN`.
   Use the discovered loopback port; do not guess 8788. Do not print the
   environment or secrets.

2. Request `http://127.0.0.1:PORT/status`. Verify `server=personal-vault`
   and that `root` matches the expected folder. If the root differs, stop
   writing and report the mismatch. Check MCP initialize and tools/list on
   `/mcp`. On 401/403, do not disable authorization or extract a token from
   the process.

3. If MCP is available, inspect the existing configuration and register:
   `codex mcp add personal_vault --url http://127.0.0.1:PORT/mcp`
   Substitute the verified port. Do not change other servers. If the name
   belongs to another Vault, report the conflict. If the CLI is unavailable,
   use this client's supported MCP configuration, preserving the existing
   config.toml.

4. Use `capture_note` to save a note titled "Connection check" with the text
   `MCP-check-7429`. Read the returned path with `vault_files_read`.
   Verify that the text matches exactly and show the path. If the tools have
   not appeared in the current chat, verify through a separate MCP SDK client
   from the app's dependencies; do not present this as an update to the
   current chat's tools.

5. If MCP is unavailable for a technical reason, an explicitly identified local
   library mode is allowed. This is not a way to bypass an authorization denial.
   Check this file:
   `/Applications/Personal Vault.app/Contents/Resources/vault/node_modules/personal-vault/lib/index.mjs`.
   Load it through `pathToFileURL`, verify `createVault`, set the confirmed
   root, save through `captureNote({title,input})` and verify with `readText`.
   Do not change files inside `.app`. If Node is unavailable, use the app's
   bundled executable with `ELECTRON_RUN_AS_NODE=1`. Do not install dependencies.

6. Do not overwrite existing notes, create a second Vault, expose the port to
   the internet or promise an automatic chat archive. For an already connected
   MCP client, do not silently switch to filesystem access. The old build's port
   changes after a restart: save minimal local rediscovery instructions beside
   the Codex configuration, without tokens or personal content.

Finish with a brief report: selected mode (MCP or library), confirmed folder,
test-note path and readback result. State separately whether a new Codex session
is needed for the registered tools. If blocked, name the exact reason; do not
delegate technical steps you can perform yourself to the user.
