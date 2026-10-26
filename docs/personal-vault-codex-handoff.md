# Personal Vault — development handoff

## Product boundary

Personal Vault is a local-first, human-readable folder. The files are the product.

A person must be able to open the Vault in Finder, Windows File Explorer,
Obsidian or any Markdown editor; understand the folders; read and move notes;
and restore a backup without a special application or account.

| Personal Vault owns | Personal Assistant owns |
| --- | --- |
| Files, folders, Markdown, attachments, search, archive and restore | Health, calories, workouts, Today, Planner, projects and recommendations |
| Neutral source material and imports | Meaning, interpretation, goals and derived actions |
| A small file API and MCP interface | Domain-specific tools and the assistant experience |

Vault must not add Health, nutrition, Planner, Today or project logic. The API
and MCP server are only a doorway to ordinary files, never a second hidden
storage system.

Before changing code, read [`../AGENTS.md`](../AGENTS.md).

## Canonical file model

```text
Personal Vault/
├── raw/YYYY/MM/
├── structured/
└── archive/
```

- Markdown files and normal attachments are the source of truth.
- Attachments live beside their note in a visible `<note>.assets/` folder.
- Archive moves files into the visible `archive/` tree.
- API responses use readable relative paths, never opaque storage IDs.
- An optional cache may be deleted without losing user data.

## Completed product work

- Personal Vault and Personal Assistant are separate repositories.
- The product and repository are named Personal Vault, without “Core”.
- The rejected hidden `.personal-vault` record store was removed from the
  product direction.
- The generic file interface supports list, read, create, update, search,
  attach, archive and restore.
- The desktop app browses the selected folder and is packaged separately in
  `personal-vault-ui`.
- OpenAI exports can be converted into readable Markdown under
  `raw/YYYY/MM/` from the desktop onboarding or command line.
- Re-importing the same OpenAI conversations skips those already present.

## Current repository split

- `personal-ai-systems/personal-vault`: readable-file engine, generic MCP and
  import scripts.
- `personal-ai-systems/personal-vault-ui`: desktop browser and packaged app.
- `kir-au/personal-assistant`: Health, Today, Planner, projects, interpretation
  and Assistant-facing MCP tools.

Do not copy Assistant implementation plans, private audits or personal evidence
into this public Vault repository. The Assistant's current architecture record
belongs in `personal-dashboard/docs/personal-assistant-architectural-vision.md`.

## Remaining transition debt

The repository split exists, but the code boundary is not fully complete:

1. The Vault MCP still exposes legacy `capture_note`, `capture_asset`,
   `search_vault`, `get_today_plan`, `get_capture_review` and
   `apply_capture_action` tools for compatibility.
2. Those tools are not part of the intended long-term generic Vault surface.
3. Personal Assistant now has its own corresponding tools and calls the Vault
   through `vault_files_*` operations.
4. Remove the legacy Vault tools only as a separately reviewed breaking change,
   after installed clients and connectors are confirmed to use the Assistant or
   generic file tools.
5. Local Personal Assistant access through the shared Vault library is approved
   (26 October 2026). It does not require an MCP server or public hosting. Its web
   routes use one configured library layer; discovery/watch infrastructure and
   standalone scripts have separately documented exceptions. Do not replace
   this local mode with mandatory network access.

This is a shared-library ownership boundary, not a process security boundary.
Do not describe it as a completed strict API boundary. People and local editors
may still work with their own files directly.

## Verification rules

- Test only with temporary Vault folders.
- Never point automated tests at a person's real Vault.
- Preserve readable paths and safe non-overwriting writes.
- A missing folder may list as empty; transport, permission and other errors
  must remain visible.
- Do not commit personal notes, exports, tokens, backups or logs.
- Verify packaged UI behaviour as well as source tests before publishing.
- Do not claim connector or browser acceptance without testing that client.

## Publication direction

- The public product identity is **Personal AI Systems**.
- The source is published under the repository's Fair Source licence.
- Optional commercial services may sit above the local Vault, but local files
  remain usable without them.
- Current preview installers and their limitations are documented in the main
  README and release notes.

## Decision test

Before accepting a change, ask:

> If the API and every app disappeared, would the person still have understandable, usable files in their own folder?

If the answer is no, the change does not fit Personal Vault.
