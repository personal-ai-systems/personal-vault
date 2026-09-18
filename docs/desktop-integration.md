# Desktop integration

Packaging lives in sibling `personal-vault-ui`, in `scripts/build-desktop.mjs` and `desktop/`.

The UI build copies this checkout's MCP server and locked production dependencies into its Mac arm64 application. It runs this repository's tests first. Source repositories stay separate; installation is one app. See `../personal-vault-ui/docs/desktop-macos.md` (from the parent workspace) for build/install details.

The desktop runtime sets `PERSONAL_VAULT_ROOT` to the user's selected existing folder, `MCP_HOST=127.0.0.1`, a dynamically selected `MCP_PORT`, and `PERSONAL_VAULT_TOKEN`. When a token is set, all HTTP endpoints require `Authorization: Bearer <token>`. Tokenless CLI behaviour is retained for existing local integrations. The root must exist before startup and is canonicalised.

File operations reject symlinks in existing path components; listing/search skip symlink entries. Create uses exclusive creation; update refuses absent files; attachment collisions return an error instead of false success. Existing note-plus-assets archive/restore work is preserved. These are safeguards, not a complete hostile-local-process sandbox or crash-atomic transaction system.

Run `npm test` for temporary-folder regression coverage. Never run tests against the real user Vault. No desktop build writes user notes into either source repository.
