# Personal Vault — development handoff

## Product boundary

The authoritative current decision is [product-boundary.md](product-boundary.md).
Vault is the independent memory store; its desktop browser is not a daily
Assistant. Older mixed-product plans cannot expand its responsibilities.

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

### Local AI connection correction — 30 October 2026

Prepared in sibling `personal-vault-ui`, not published or installed on a second
Mac. The reported state (app running, selected folder empty, no Codex registration)
does not prove a broken Vault. The client connection was missing. The current
desktop server uses dynamic ports; a copied fixed localhost URL is not durable.

The prepared change adds `desktop/mcp-connection.cjs` and
`desktop/codex-mcp-bridge.cjs`, wires a **Connect Codex…** app menu, and packages
both files. The generated registration command uses the bundled Node executable
and contains no credentials. A mode-0600 connection descriptor outside the Vault
supplies the rotating loopback address/token; the relay forwards to the existing
MCP server and never performs Vault file operations directly. Initialization
guidance names capture/readback tools and forbids silent filesystem fallback.

The launcher now also passes `MCP_SERVICE_TOKENS`: its previous
`PERSONAL_VAULT_TOKEN` is not checked by the pinned 0.6.1 server. The original
claim that this desktop token protected all HTTP endpoints was incorrect.
The prepared launcher requires MCP HTTP authentication without loopback bypass;
readiness metadata remains public on loopback. Never expose preview.3 publicly
on the assumption that its legacy token protects it.

Verified: `test:mcp-bridge`, UI tests, Vault tests, production build, packaged
`test:desktop`, and post-launch ad-hoc signature validation. All writes used
temporary test Vaults/settings. Tests cover capture/read through the packaged
relay, tool discovery, no-token rejection, wrong token, private descriptor,
port/root changes and stopped-app errors. No actual Codex configuration or real
Vault was changed; a second user's client acceptance is still pending.

User guide: `docs/connecting-ai-clients.md`. The full rendered instructions were
verified in external macOS Chrome. The guide is prepared for review; it has not
been sent to a tester. Private backup receipts stay outside this shared repository.

Next: review/release a distinct installer, then verify actual local client
discovery, test capture/read, restart and offline behavior on the second Mac.
ChatGPT web needs separately configured supported remote access or Secure MCP
Tunnel and authentication. It is not enabled by local Codex registration.
No automatic all-chat archival or remote tunnel was installed by this work.

Follow-up on 30 October: the user confirmed local Codex as the tester's client.
The guide now leads with that path and documents an in-place Finder **Replace**
upgrade, preserving the selected Vault and app settings. README, desktop install
and testing docs use the same guidance; obsolete quarantine-removal instructions
were removed. Replacement alone does not establish trust for a new downloaded
ad-hoc build. Developer ID signing and Apple notarization precede an in-app update
feed. No updater is configured and no signing identity was available on the
development Mac at this check. A new installer, real old-to-new upgrade and client
acceptance on the tester's Mac remain unverified. This follow-up changes docs only.

### General checks

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
