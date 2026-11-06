# Personal Vault: connecting Codex and updating the app

Checked against source code and OpenAI documentation on 30 October 2026.
The instructions for the **Connect Codex…** menu apply to the prepared app
update. The published preview.3 does not have this menu yet. A new installer
has not been published, and connection on another Mac has not been verified.

Local checks covered `test:mcp-bridge`, UI tests, the production build and the
complete `test:desktop` suite for the packaged app. A temporary MCP client
discovered tools, saved a note and read it through the bridge inside the app
bundle. Checks covered rejection without a token, connection-file privacy,
address/folder changes and the absence of fallback. This is not verification
of a live Codex/ChatGPT conversation on another person's computer.

The main scenario in this guide is **local Codex on the same Mac**.
It does not require a public server, a separate web plugin or a tunnel.
The ChatGPT web section is an additional scenario; it is not required to
connect Codex.

## Already installed preview.3: use it now, without updating

The new Connect Codex menu is more convenient, but diagnostics need not wait
for its release. Local Codex can discover and verify the old version's
already running server. Give it these instructions:

> Do not reinstall Personal Vault or start a second server. Find the process
> whose command points to `/Applications/Personal Vault.app/Contents/Resources/vault/node_modules/personal-vault/mcp/personal-vault-server.mjs`.
> Do not read or print the process environment, which may contain secrets.
> For its PID, identify the TCP LISTEN port with
> `lsof -nP -a -p PID -iTCP -sTCP:LISTEN`.
> Do not assume port 8788. Request `/status` from that discovered loopback
> server. Verify `server=personal-vault` and that `root` matches the folder
> selected in the app. Then check MCP initialize and tools/list on `/mcp`.
> If access works, inspect the existing Codex registration and register the
> discovered URL as `personal_vault`, without changing other MCP servers.
> If that name already points to another Vault, report the conflict.
> After registration, explain how to start a new session with the tools.
> Do not claim the current session has received tools that are absent.
> If the server requires unavailable authorization, report this; do not
> disable authorization or extract secrets from the process.

For a successfully verified and accessible local server, the command is:

```sh
codex mcp add personal_vault --url http://127.0.0.1:ACTUAL_PORT/mcp
```

Replace `PID` and `ACTUAL_PORT` with the verified values. This is a temporary
registration of the old build's address: the port changes when the app
restarts, so it must be discovered and updated again. Do not expose this port
to an external network. Once the tools appear, verify saving and reading
as described in section 2.

### Alternative: the installed file library

If the owner chooses local library access, Codex can load
`/Applications/Personal Vault.app/Contents/Resources/vault/node_modules/personal-vault/lib/index.mjs`,
verify the `createVault` export and create an instance with the confirmed
`root`. Save a note with `captureNote({ title, input })`, then verify it with
`readText` using the returned path. Convert paths containing spaces with
`pathToFileURL` before dynamic import. Do not modify files inside `.app`.

This is **a different mode, not MCP**. Name the selected mode before writing,
use the same Vault and library operations instead of a custom store or
arbitrary shell writes. Direct local access is permitted by the product
architecture, but it is not a way to bypass an MCP authorization denial.
Neither mode automatically saves all conversations.

## What the post-installation report means

| Observation | What it proves |
| --- | --- |
| The app is open and its MCP process is running | The local runtime is running. This does not yet verify an AI connection. |
| An empty folder is selected | This is a valid new store. Chat history is not copied there automatically. |
| Codex has no Personal Vault server | The integration is not yet registered in this client. |
| The assistant can write directly to the folder | It has filesystem access. This does not verify MCP. |

To test the app itself, create one non-sensitive note with **New note**, save
it, find it through search and open it with **Show Vault in Finder**.
Then close and reopen the app: the note should remain. Do not reinstall the
app or change the selected folder merely because it is empty.

## 0. Updating the app without deleting it

You do not need to delete the old version before updating:

1. Save open notes and quit Personal Vault with **⌘Q**.
   If Codex is using its connection, end the current session.
2. Download the new verified DMG and open it.
3. Drag **Personal Vault.app** into **Applications**. When Finder asks,
   choose **Replace**. Do not choose Keep Both.
4. Eject the DMG and launch **/Applications/Personal Vault.app**, not the copy
   inside the disk image. Check the version in **About Personal Vault**.
5. Check the sidebar path and open an existing note. Then start a new Codex
   session and verify reading through MCP.

This replaces the app, not the selected notes folder. If the app name,
settings directory and installation location stay the same, the folder
setting is preserved and the existing bridge registration should remain
usable. If the app asks you to choose a folder again, select **Open an existing
folder** and point to the previous Vault; do not create a second one.
If Connect Codex has appeared for the first time, connect using section 1.
If the app was moved, run the menu command again.

Do not use AppCleaner or delete the Vault folder or Library settings for a
normal update. Verify your own backup of important notes.

**Replacing the app does not resolve Apple's block.** The current preview
has an ad-hoc signature, but no Developer ID signature or Apple notarization.
A newly downloaded build may require permission in **Privacy & Security**
again, even after the previous build was approved. This is a limitation of
our distribution, not a user error. Do not disable Gatekeeper or remove
quarantine using Terminal commands.

The developer-side fix is to sign releases with a **Developer ID Application**
certificate, submit them for **notarization** and staple the ticket to the
distribution. Verified in-app updates can be added afterward. There is no
built-in automatic updater yet. It does not replace signing and notarization;
installing an updater library alone does not resolve this problem.
The exact upgrade path on a second Mac still needs verification.

## 1. Local Codex: connect to the app's server

This path is for Codex running tools on the same Mac. It does not require
publishing Vault on the internet. Codex CLI must be installed and available
in Terminal; the presence of the ChatGPT app alone does not establish that.
For the currently published preview, first obtain the updated build with
the connection menu. Do not invent a port or use someone else's Vault address.

1. Open Personal Vault and check the selected folder in the sidebar.
2. In the macOS menu bar, select **Personal Vault → Connect Codex…**.
3. Click **Copy command**, paste the command into Terminal and run it once.
   It registers the `personal_vault` server in Codex. It does not transfer
   history, change the Vault or install global instructions in every chat.
4. Run `codex mcp list`. The list should show `personal_vault` as enabled.
5. Start a new local Codex session; restart the client if necessary.
   Check that `capture_note`, `vault_files_read` and `vault_files_search`
   are available. For manual setup, use MCP → Add server → STDIO; take the
   executable and arguments from the copied command and set
   `ELECTRON_RUN_AS_NODE=1` as an environment variable.
6. Keep Personal Vault open while using the connection.

The copied command has this form; the app supplies the paths:

```sh
codex mcp add personal_vault --env ELECTRON_RUN_AS_NODE=1 -- \
  '/Applications/Personal Vault.app/Contents/MacOS/Personal Vault' \
  '/Applications/Personal Vault.app/Contents/Resources/app.asar/desktop/codex-mcp-bridge.cjs' \
  '/path/from/the/app/mcp-connection.json'
```

The bridge uses Node bundled with the app. It forwards MCP requests over
stdio to the HTTP MCP server of the already running Personal Vault.
It creates neither a second store nor a second Vault server. The dynamic
port and token are read from a private connection file in Application
Support, separate from the notes. The token is not included in the command
or Codex configuration. Do not send the connection file to other people.

After the app restarts, the bridge rereads the current address. If Codex
disabled an unavailable server, reconnect it or start a new session.
After moving the app, run the menu command again. If another server named
`personal_vault` is already configured, inspect it first; do not replace
someone else's connection.

## 2. Verification: write and read through MCP

Send this to a new session with the server connected:

> Use only Personal Vault MCP. Call capture_note with the title
> "Connection check" and the text "MCP-check-7429". Then call vault_files_read
> for the path returned by the server. Show the path and the text read back.
> Do not use Terminal or direct filesystem writes. If a tool is unavailable,
> report this; do not substitute another way of writing.

The check passes only when the actual calls to both tools, their responses,
the exact text and the same file in Personal Vault are visible. Saying
"saved" without a tool call is not evidence. Repeat the text search with
`vault_files_search`.

Also close Personal Vault and ask the client to read the same file through
the connection: it must report unavailability rather than silently switch
to the filesystem. Reopen the app and reconnect the client. Create test
records only in the selected test folder.

## 3. Instructions for future conversations

This text can be used in project instructions or the intended chat.
It guides assistant behaviour, but does not install MCP or technically
restrict disk access.

> Use the Personal Vault MCP connection to read and save in my Personal Vault.
> For a new note, call capture_note; to read, search or change an existing
> note, use the corresponding vault_files_* tools. Use the relative paths
> returned by the server. Do not create a second copy of the Vault or select
> another folder. If the connection is unavailable, report this and do not
> switch to direct disk writes without a separate request.
> When I ask you to save a conversation's outcome, save the facts, decisions,
> open questions and next step available to you, then read the saved file
> and show its path. Do not call a summary a complete transcript.
> Do not claim to have read other chats or to automatically archive all
> conversations. Save only content within my request's scope.

To save a particular conversation, this instruction is sufficient:

> Save the outcome of this conversation in Personal Vault through MCP and
> verify it by reading it back.

## 4. ChatGPT on the web: separate setup

Local Codex registration does not create a plugin in ChatGPT.
A web connection requires a reachable server or **Secure MCP Tunnel**.
In the web client, `localhost` does not point to your Mac. This build
does not ship a ready-to-use secure tunnel configuration.

Once the owner has configured and verified that access:

1. Open ChatGPT on the web and go to **Plugins**.
2. Select **+ → Add custom MCP server** and name it `Personal Vault`.
3. Enter the verified Server URL or Tunnel connection and configure supported
   authentication. Availability depends on account and workspace permissions.
4. Create and install the plugin. Select it with `@` in the intended
   conversation.
5. Perform the same write/read check in a separate test folder.

Do not expose the local port to the internet, forward the internal token
or use **No authentication** for public access to personal notes.
The current server's Google bearer-token validation does not mean that
the complete ChatGPT OAuth flow is implemented. This guide does not
establish a working web connection.

## 5. What does not happen automatically

MCP handles client requests. It does not receive every conversation in the
account or know when a conversation has ended. This distribution has no
automatic archive of every chat. An instruction is neither a background
service nor a guaranteed trigger.

Two separate scenarios are currently available: save a selected outcome
through MCP, or import an existing OpenAI export with **Import OpenAI data**.
Importing history does not connect AI or enable subsequent automatic saving.

## For developers: what was fixed and what remains

- The Connect Codex menu, a stable stdio bridge and a private description of
  the current connection have been prepared. Codex settings change only
  when the command is run.
- Forwarding of `MCP_SERVICE_TOKENS` was fixed: the previous launcher passed
  only `PERSONAL_VAULT_TOKEN`, which the pinned server version 0.6.1 does
  not validate. The old preview.3 cannot be considered protected by its
  per-launch token on MCP; the network bind remains loopback. Do not expose
  its MCP through a tunnel unchanged.
- Separate work remains: publishing a new build, verification on a second
  Mac, a real connection in the user's account, a secure web tunnel and
  automatic chat export if separately agreed.
- For convenient updates: first Developer ID and notarization for every
  release, then a maintained update feed and explicit installation that
  preserves notes, settings and the Codex connection. Automatic updating
  is not implemented in the current code.

Official documentation checked on 30 October 2026:
[Codex MCP setup](https://learn.chatgpt.com/docs/extend/mcp),
[Custom MCP connections in ChatGPT](https://developers.openai.com/api/docs/guides/custom-mcp-server),
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

macOS update requirements:
[Apple Developer ID and notarization](https://developer.apple.com/developer-id/),
[Electron autoUpdater signing requirement](https://www.electronjs.org/docs/latest/api/auto-updater#macos).
