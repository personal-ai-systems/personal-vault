# Desktop integration

Packaging lives in sibling `personal-vault-ui`, in `scripts/build-desktop.mjs` and `desktop/`.

The UI build installs the exact Vault package revision recorded in
`personal-vault-ui/desktop/vault-dependency.json`. The server and file library
come from that same package, not hand-copied source files. The build checks the
revision, package exports and temporary server startup before packaging. Source
repositories stay separate; installation is one app. See
`../personal-vault-ui/docs/desktop-macos.md` for build/install details.

The desktop runtime sets `PERSONAL_VAULT_ROOT` to the user's selected existing folder, `MCP_HOST=127.0.0.1`, and a dynamically selected `MCP_PORT`. The server authenticates MCP calls using `MCP_SERVICE_TOKENS`; `/status` and `/healthz` are public readiness metadata. The old launcher passed only `PERSONAL_VAULT_TOKEN`, which the pinned server 0.6.1 does not check. The prepared desktop correction passes both variable names, enforces HTTP authentication and disables loopback bypass. Tokenless CLI behaviour is retained for existing local integrations. The root must exist before startup and is canonicalised.

The prepared desktop connection uses `mcp-connection.json` (mode 0600) in app userData to publish the current loopback endpoint and token to a local stdio relay. The relay forwards MCP requests to the app-owned server; it does not operate on Vault files. App menu → Connect Codex… copies a registration command without credentials; executing it is the user's explicit setup action. This does not install a ChatGPT web plugin or archive conversations. See [client setup and acceptance](connecting-ai-clients.md). Published preview.3 does not yet contain this correction.

File operations reject symlinks in existing path components; listing/search skip symlink entries. Create uses exclusive creation; update refuses absent files; attachment collisions return an error instead of false success. Existing note-plus-assets archive/restore work is preserved. These are safeguards, not a complete hostile-local-process sandbox or crash-atomic transaction system.

Run `npm test` for temporary-folder regression coverage. Never run tests against the real user Vault. No desktop build writes user notes into either source repository.
