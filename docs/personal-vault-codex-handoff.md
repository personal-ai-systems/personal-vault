# Personal Vault — Codex handoff

## Read this first

Personal Vault is a **local-first, human-readable folder**. Its files are the product.

A person must be able to open the Vault in Finder, Obsidian, or any Markdown editor; understand the folders; read and move notes; and restore a backup without a special application or account.

The Vault API and MCP server are only a convenient doorway to those same files. They must never become a second, hidden storage system.

Before making changes, read [`../AGENTS.md`](../AGENTS.md). It is the governing implementation contract.

## Product boundary

| Personal Vault owns | Personal Assistant owns |
| --- | --- |
| Files, folders, Markdown notes, attachments, search, archive and restore | Health, calories, workouts, Today, Planner, projects, recommendations and AI workflows |
| Neutral source material such as a photo, an export or a weight entry | The meaning, interpretation and derived actions based on that material |
| A small API/MCP interface over visible files | The user-facing assistant experience and domain-specific tools |

Vault must not add Health, nutrition, Planner, Today or project logic.

## Canonical file model

The real user data lives in a normal tree such as:

```text
/Users/kirill/personal-vault/
  raw/YYYY/MM/
  structured/
  archive/
```

- Markdown files and their normal attachments are the source of truth.
- An attachment belongs beside its note in a visible `<note>.assets/` folder.
- Archiving moves a note to the visible `archive/` area; normal product use does not permanently delete user files.
- API responses use readable relative paths, never opaque IDs.

## What was intentionally rejected

An earlier implementation created a hidden `.personal-vault` store, copied roughly 878 existing human files into opaque records, and made the Assistant use that separate copy. This was rejected and removed from the product direction.

Why it was wrong:

- It created two possible versions of the same information.
- A person could not simply browse or understand their own data.
- Backup and recovery became harder to reason about.
- It made the UI less useful while adding migration and mismatch risk.

Do not revive this design under another name. Do not introduce a hidden canonical index, internal record identifiers, a separate data format, or domain-specific metadata. A temporary search cache is acceptable only if the Vault still works fully when it is absent.

## What has been completed

- Personal Vault is separated from Personal Assistant as its own repository and product boundary.
- The project direction was renamed from “Personal Vault Core” to “Personal Vault”.
- The hidden-store approach was replaced with readable files and paths.
- Vault MCP exposes a deliberately small file-oriented surface: list, read, create, update, search, attach, archive and restore.
- Assistant MCP has been changed to use the Vault layer for its core Vault operations rather than treating the Vault as its own data store.
- Vault documentation has been simplified around ordinary files: `README.md`, `AGENTS.md`, `docs/using-personal-vault.md`, and `docs/personal-vault-api.md`.

## Current local state — inspect before acting

At the time this handoff was written, the Vault repository has uncommitted changes in:

```text
mcp/personal-vault-server.mjs
scripts/mcp-smoke-test.mjs
```

The diff is larger than an archive/restore tweak: it merges the retired capture facade into this server (capture tools, auth, `.assets` archiving), and it consolidates the MCP surface onto a single endpoint, `/mcp`, with underscore tool names. Any caller still sending dotted names (`vault.files.read`) must migrate to the underscore names. Treat all of it as a proposal until you inspect the diff and run its test against a temporary Vault folder. Do not overwrite, discard, or mix these changes with unrelated work.

The Personal Assistant repository also has unrelated uncommitted work. Keep Vault changes focused and do not assume every Assistant change is part of this migration.

## Safe next steps

Work in small, reviewable increments. Each should take less than a day.

1. Review the current uncommitted archive/restore change. Verify that note and attachments move together, restore together, and do not touch the real Vault. Commit it separately if correct.
2. Make save behaviour safe and understandable: do not silently overwrite a different existing file; return plain error messages.
3. Test the complete visible file journey in a temporary folder: create note, attach file, search, edit, archive, restore.
4. Inspect the resulting folder manually. The API must not be needed to understand the result.
5. Verify the Vault MCP flow through the real Assistant connector in actual Chrome before claiming connector acceptance.
6. Inventory remaining direct filesystem access in Personal Assistant. Move one page or script at a time to the Vault API, starting with generic file operations.
7. Keep domain-specific migrations separate: Health, Today and Planner must remain Assistant work, not Vault work.
8. Build a minimal Vault Browser only after the file journey is stable: file tree, Markdown preview/edit, save, archive and restore. It is not a replacement for Personal Assistant.

## Operating rules

- Test against a temporary folder, never the real Vault, unless the user explicitly asks otherwise.
- Preserve existing user changes and uncommitted work.
- Do not commit personal files, tokens, backups or logs.
- Do not claim browser or connector acceptance without checking it in actual Chrome.
- Explain changes in plain language. Avoid unnecessary storage-system terminology.
- When uncertain, preserve readability and user control rather than adding abstraction.

## Business and publication direction

- This is independent personal R&D, not employer work.
- The intended public product/organisation identity is **Personal AI Systems**.
- The aim is eventually a public local-first product, but it is not a public release yet.
- The preferred licensing direction is source-visible Fair Source with commercial-use limits. Select and review the exact licence before publishing; do not present this as legal advice or a completed legal decision.
- Potential paid offerings belong above the local Vault — for example, optional hosted integrations, managed sync or richer Assistant services — not ownership of a person's local files.
- Intended backup integrations are iCloud and Google Drive; Backblaze is not currently in scope.

## Decision test

Before accepting a change, ask:

> If the API and every app disappeared, would the person still have understandable, usable files in their own folder?

If the answer is no, the change does not fit Personal Vault.
