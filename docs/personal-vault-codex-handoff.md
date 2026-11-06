# Personal Vault — development handoff

## Product boundary

The authoritative current decision is [product-boundary.md](product-boundary.md).
Vault is the independent memory store; its desktop browser is not a daily
Assistant. Older mixed-product plans cannot expand its responsibilities.

Personal Vault is a local-first, human-readable folder. The files are the product.

## Tool response compatibility — 7 November 2026

Active in the running service and verified from Moltis, 09:37 Sydney.
`vault_files_list`, `vault_files_read`, `vault_files_search`, the legacy
`search_vault` alias and the pre-existing `vault_context_get` now return the same
object serialized as JSON in `content[].text` as well as in `structuredContent`.
Rationale: hosts such as Moltis render text only and drop `structuredContent`, so
those tools previously delivered an acknowledgement sentence with no body, no
list paths and no search hits.

Scope is those five surfaces. `structuredContent`, schemas, authorization and path
checks are unchanged; `vault_files_read_binary` keeps `dataBase64`
structured-only, and the write, archive, trash, restore, deleted-listing and
capture tools are untouched. `vault_files_list_deleted` and the capture tools
still return acknowledgement-only text as a known gap outside this change.
Failures are unchanged: `isError` with plain non-JSON text and no
`structuredContent`.

One `textAndStructured` helper beside the tool registrations serves the four file
surfaces. The smoke fixture asserts parity both ways: `JSON.parse(text)` equals
`structuredContent` for a successful list, read, search and `search_vault`, the
parsed body and paths are real rather than an acknowledgement, and a failed read
stays `isError` with no `structuredContent` and non-JSON text. Authentication is
pinned rather than inherited — the fixture sets `MCP_SERVICE_TOKENS` with explicit
`MCP_TRUST_LOCALHOST=false`, `MCP_GOOGLE_AUTH=false` and `MCP_CONTEXT_FILE=''` —
because an ambient `MCP_TRUST_LOCALHOST=true` makes the unauthenticated
`initialize` succeed with HTTP 200, so the 401 expectation would **fail**, not
pass vacuously. Same unauthenticated call returns HTTP 200 with trust on and
HTTP 401 with it off. That is test isolation only; production authentication is
untouched.

Three surfaces stay distinct: the **source** carries the fallback, the
**running** HTTP service on `127.0.0.1:8788` serves it after activation, and the
**desktop** app consumes the same library rather than this HTTP adapter. No
desktop build, release or verification was performed.

## Passage retention and coverage honesty — 7 November 2026

Active in the source and now live in the rebuilt index.

Before: `extract()` kept only 32 passages per file by uniform spread sampling, so
a 97-passage note lost 65 passages including its middle, and every stored excerpt
was cut to 300 characters against an extraction block of up to 1600. A matching
source hash was therefore not enough to reach a mid-document correction. Coverage
reporting was half-honest: `passageCoverageComplete` did account for dropped whole
passages and whole-file text truncation, but it ignored excerpt cuts entirely, so
a passage stored as a fragment still counted as complete.

Now: every computed passage is retained by default, with the 4 MiB per-file byte
limit as the real bound on a source's contribution. `maxPassagesPerFile` remains
an explicit opt-in cap of 2–1000 whose loss is reported (`counts.cappedFiles`,
`counts.omittedPassages`, and `indexedSourceTruncated` per result). The stored
excerpt default is 1,600 characters and `counts.excerptTruncatedPassages` now
feeds `passageCoverageComplete`, so an excerpt cut makes coverage honestly
incomplete. `indexedSourceTruncated` also carries stored excerpt loss, not only
omitted passages or file bytes. `extractorVersion` moved to 2 so an existing index
rebuilds instead of inheriting old settings; caller `limit`/`maxChars` caps and
the result shape are unchanged. A pre-existing cache with no
`excerptTruncatedPassages` count reports coverage incomplete until refresh, which
is deliberate.

Tests: 20 context-index tests and 16 Codex-memory hook tests pass, full
suite exit 0.

Live reindex verified by the coordinator: 67,157 passages, 0 whole passages
omitted, 632 excerpt-truncated passages, 0 text-truncated files, and the known
pre-existing symlink scan error retained. `vault_context_get` now returns the AI
roadmap at rank 1 and the formerly omitted `structured/projects/ai/current-plan.md`
amendment at rank 2, lines 248–257, matching hash `941c123d`, amendment visible
in full.

Earlier isolated-copy measurement of the same change: 13.06 MB / 25,309 passages
/ 41,785 omitted before, 31.14 MB / 67,094 passages / 0 omitted after with 632
excerpt cuts, refresh about a tenth slower. That is one local corpus, not a
universal multiplier; lookup cost grows with index size because retrieval loads
and scans the whole file.

Source tests and the live local service do not establish a published or installed
desktop release. Remote source publication is recorded in Git history; desktop
packaging remains unverified for this change.

## English MVP presentation — 7 November 2026

The owner confirmed English for the MVP interface, product documentation,
public agent instructions and code comments. User-authored memory, archives and
indexes may use any language and remain unchanged. Future interface localization
is deferred until there is demand. The language of a prompt must not choose a
project or create a user language profile. See the authoritative
[language boundary](product-boundary.md#mvp-language-boundary--7-november-2026).

The connection guides have been translated with their commands, paths and dated
release limitations preserved. Documentation examples use English; multilingual
test data remains intentional evidence of Unicode preservation. The paired UI
uses explicit English dates in Memory instead of the host's default language.

The optional Codex adapter now uses one MVP protocol label, `Memory:`, with
nonempty disclosure content in any language. Unicode tests cover questions and
final answers; no language-specific label allowlist remains. This syntax check
does not validate meaning. Intent-based context selection remains a separate
follow-up and is not claimed as implemented by this change.
No new language profile, localization framework or vector store is introduced.

Validation for this local documentation/UI slice: the two translated guides
retain their fenced commands, paths, links and section/step structure. The
Markdown scan found no remaining Cyrillic, Han or Thai prose in either repository;
this check is not a ban on multilingual fixtures. Whitespace and secret checks
passed. The paired UI passed its six test suites and production build/typecheck.
Desktop staging stopped because its dependency pin is `115c249e660d`, while the
Vault checkout is `ce7cb821d8c5`; no stale package was used to claim acceptance.
The installed app and running services were not changed. Source changes are
prepared for a scoped language-boundary commit; packaging, installation and
external-browser verification remain separate from source checks.

## Local Codex memory delivery — 7 November 2026

Implementation and source push were authorized after protocol review. The optional
consumer adapter in `integrations/codex/` now supplies bounded current context on
session/prompt events, records readable retrieval receipts, optionally captures
new main-chat dialogue, and checks visible memory-disclosure prefixes before
answers/questions. `scripts/install-codex-memory.mjs` preserves unrelated client
hooks and previous configuration. It never grants hook trust. Instructions:
[`codex-memory.md`](codex-memory.md); shared contract:
[`agent-memory-protocol.md`](agent-memory-protocol.md).

The MCP context tool now advertises an output schema and read-only annotations;
malformed authored annotation fields are reported without poisoning the whole
response. Startup guidance includes index-first retrieval and actual-read
disclosure. Repository instructions carry the same disclosure requirement.

Validation: `npm test` passed (46 file-library checks, MCP/import fixtures,
18 context-index cases, worker lifecycle, installer checks and 15 Codex-adapter
cases); `npm run test:context` passed 12 cases. Secret scan, whitespace check and
package dry run passed. There is no separate engine compilation step. Tests use
temporary Vaults. Source fixtures are not a desktop-model acceptance test.

The first GitHub run passed macOS/Linux but exposed Windows force-termination
semantics in the worker shutdown fixture. The follow-up supports graceful IPC
disconnect, retains POSIX signal coverage, and makes symlink/ownership fixtures
portable without relaxing containment or unknown-owner lock handling. The full
local suite passed again; inspect the follow-up CI result for Windows acceptance.

Runtime verification: the owner-configured local server was reloaded and an SDK
client saw 19 tools including `vault_context_get`, retrieved a current context
response and read exact owner-selected `vault://context` bytes. Initial Codex
discovery marked four hooks untrusted. A later read-only discovery reported all
four trusted and enabled, without errors; the installer does not grant trust.
An actual compaction event then loaded a bound checkpoint excerpt, and prompt
retrieval was observed in another existing session. This is host execution
evidence, not a fresh-chat or universal-client acceptance result. ChatGPT
web/mobile and packaged UI remain separate.

Relocation audit: the company workspace contains independent repositories, not
an umbrella Git checkout. Assistant's local dependency and test path resolution
were migrated to the moved Vault. Desktop UI still uses bundled MCP; local
Assistant uses the library. Existing compatibility aliases are retained. The
context-index service now uses the canonical checkout. Personal source records,
client configurations and audit receipts stay outside published repositories.

Next: real fresh-chat/resume acceptance and answer-quality evaluation. Check
the current source/read receipt before claiming memory was used. The disclosure
check validates presence, not semantic truth. Capture starts at activation and
does not claim import of old history, tool traces or subagent chats. The existing
semantic review schedule is configured separately; a later successful independent
run must be observed before claiming continuous semantic maintenance.

## Context indexing continuation — 6 November 2026

Implemented in source: a rebuildable readable source/passage index, authored
context annotations, incremental refresh/watch CLI and the shared `getContext`
contract exposed as `vault_context_get`. Contexts boost relevance, never act as
project access lists. Original files, broad search and full-source reading stay
available. Semantic summaries belong to the consuming Assistant/model.

Changed files: `lib/context-index.mjs`, `lib/index.mjs`, `lib/index.d.ts`,
`mcp/personal-vault-server.mjs`, `scripts/context-index.mjs`,
`scripts/context-index-test.mjs`, `scripts/context-index-worker-test.mjs`,
`scripts/mcp-smoke-test.mjs`, `package.json`, `README.md`, this handoff and
`docs/context-index.md`.

Verification: `npm test` passed, including 46 file-library checks, MCP/local
retrieval parity, importer fixtures, 17 context-index cases and the watch-worker
fixture. `npm run test:context` passed all 12 provider-neutral context cases.
Secret scan and package dry run passed; there is no separate engine build.
All automated test data is temporary. Review fixed pagination candidate loss
and cached annotation freshness; regression cases cover both.

Source tests do not update an installed desktop package or an existing MCP
client. Host-specific worker configuration, personal curation, backup and browser
verification belong in the private Vault checkpoint, not this public handoff.
No new release, commit or push is claimed by this checkpoint.

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
