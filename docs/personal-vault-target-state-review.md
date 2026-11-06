# Personal Vault: target-state review

30 October 2026. Status: read-only architecture review and proposed follow-up,
not a storage migration, a release or permission to retire existing tools.

## Subsequent boundary correction — 30 October 2026

The user authorised correcting positioning and separating conflicting guidance.
The current authoritative decision is [product-boundary.md](product-boundary.md).
Repository instructions/introductions and current private project guidance now
point to it; historical source bodies and task states are preserved.

Four unused Assistant implementations were removed from the UI source:
Resume Me and the resume/today/transcript route handlers. Their paths remain
explicitly rejected, with a new source/guard regression suite. The incorrect
review heading has been removed from its renderer; it was review-wrapper copy,
not a product feature. Legacy MCP semantics remain compatibility debt.

The original audit below is a dated snapshot. Its disabled-UI-source finding is
now addressed; do not recreate those files or describe every other follow-up
as completed. No installed app, live service or published release was changed.

## Conclusion

Personal Vault is **personal memory in files the person owns**. It is not a
dashboard, notebook-only product, database UI or autonomous Assistant.

The recent Memory wording restores that purpose; it does not require another
storage architecture. Keep readable Markdown, ordinary attachments, meaningful
paths and optional access through the shared library or MCP.

The largest remaining mismatch is not the word `note` in historical text. It is
the coexistence of superseded operating documents, legacy Assistant behaviour
inside the Vault MCP service, and an unreleased desktop redesign.

## Evidence and limits

This review used direct local filesystem reads, not the Vault MCP server.
Archived project discussions were compared with current source in the paired
Vault/UI repositories and the local Assistant's architecture/client layer.
Private source text, the full personal-file inventory and scan manifests are
deliberately excluded from this repository.

Evidence strength is different:

- The user's current statements establish the Memory terminology, simple
  readable storage, product boundary and approved local-library access.
- Archived summaries establish what was recorded at that time, not that every
  suggested implementation was approved or remains current.
- Current source inspection establishes what the checked-out code contains,
  not which version is installed, published or accepted by a real client.
- No service was restarted, no real Vault file was rewritten, no connector was
  reconfigured, and no fresh end-to-end/runtime test was performed in this audit.
  Earlier packaged-test receipts remain dated receipts, not a new test run.

## Target that remains valid

| Concern | Target |
| --- | --- |
| Product meaning | Memory of what happened, conversations and material the person wants to keep |
| Canonical data | Readable files and attachments in a folder selected by the person |
| Ordinary UI | Recent, Memory, Files; separate Recently Deleted and Archive |
| Advanced UI | Original folders, instructions and technical material through All files |
| Interpretation | Assistant/client owns meaning, Health, Today, Planner, goals and execution |
| Local access | Shared Vault library or authorised direct file access; no compulsory public server |
| Remote access | Optional configured, authenticated API/MCP access; installing the app is not automatic client registration |
| Metadata | Optional descriptive headers; not a prerequisite for reading/searching, proof of truth or proof of human approval |
| Derived material | Rebuildable views/caches; never a second hidden canonical store |
| Portability | Provider- and platform-independent data; platform installers and real-client acceptance tested separately |
| Recovery | Archive and recoverable deletion remain distinct; restore without overwriting existing files |
| Distribution | Personal Vault under the Personal AI Systems product identity; optional commercial services must not make local files unusable |

No new record IDs, mandatory schema, vector database, graph store, permanent
deletion, background AI service or full-archive model processing follows from
these targets.

## History to preserve, not execute again

The following is a reconciliation of project history, not a new schedule:

1. Early architecture work already described portable, readable personal memory.
   It also contained proposed UUIDs, indexes, classifications and additional
   services. Those proposals are not a single approved implementation contract.
2. Later raw-memory discussions separated saving what was said from interpreting
   it and changing a plan. A saved conversation must not become a commitment
   merely because it was discovered.
3. The product split gave neutral storage to Vault and interpretation/execution
   to Assistant. The independent simple desktop client remains valid; an older
   description of storage as headless is not a prohibition on that UI.
4. Core naming, year-end execution gates, network-only access and the hidden
   record-store direction were superseded. Do not restart repository extraction
   or implement an old record contract because it appears in an old plan.
5. Local shared-library access was explicitly accepted. Its purpose is one owner
   for file mechanics, not forcing every local read through an HTTP service.
6. The latest explicit vocabulary is Memory, not Note/Capture/Entry/Node. It
   changes presentation, not historical statements, filenames or compatibility
   identifiers.

A September chat/voice-trigger and local-model idea remains a recorded proposal
whose technical form was explicitly unagreed/unimplemented. Do not silently call
it cancelled or delivered, or treat it as permission to embed reasoning inside
the neutral Vault. Reconcile any future implementation with Assistant ownership.

Source dates must come from the actual conversation/evidence when available.
An imported filename or a filesystem modification time alone does not establish
when a decision happened. Some saved archives explicitly acknowledge missing
sessions; this review cannot reconstruct conversations absent from disk.

## Current source: aligned parts

- [AGENTS.md](../AGENTS.md) and
  [the development handoff](personal-vault-codex-handoff.md) already state that
  files are authoritative and Assistant owns domain meaning.
- The public library and generic `vault_files_*` tools operate on readable paths.
  The rejected hidden record store is not the current storage implementation.
- The local Assistant uses `lib/vault.ts` and the shared package. Do not undo that
  approved local mode merely to make a process-boundary diagram look stricter.
- The UI worktree has Memory/Files navigation and Add to memory wording, grouped
  content and an advanced original-file view. Its internal `notes` view key and
  `NoteActions` module name do not create a different data model.
- [Provider-neutral context delivery](provider-neutral-context.md) already
  separates owner-selected instructions from imported content and requires the
  host to load/refresh context. Files do not automatically become another
  model's active memory.
- Recoverable deletion is a readable lifecycle location, not a hidden canonical
  database. It must not be confused with the rejected hidden record store.

## Remaining mismatches and safe corrections

### 1. Current instructions can revive superseded plans

Some live data-folder guidance still requires frontmatter/indexing, calls the
product Core, repeats date-driven extraction gates, or assigns execution to
Vault. Several historical roadmap documents correctly carry supersession
notices, but other files still present the old statements as current.

Proposed correction: reconcile the current entrypoint/README/project checkpoint
with this target, and mark old directions as historical with a pointer to the
current source. Preserve the original dated bodies and task history. Do not
globally replace words in source conversations or rewrite every old decision.
Edits to the real user's Vault are a separate action from this read-only audit.

### 2. Vault MCP still contains Assistant-specific compatibility behaviour

In [mcp/personal-vault-server.mjs](../mcp/personal-vault-server.mjs):

- `get_today_plan` reads a specific Assistant projection and interprets task
  dates/status. This is genuinely Assistant logic, not just a filename mention.
- `capture_note` adds a plan-review proposal.
- `get_capture_review` and `apply_capture_action` expose conversational
  review/approval concepts.
- `apply_capture_action` returns `approved: true` from the supplied arguments.
  That response is not independent evidence of human approval or a persisted
  approved action.

Proposed correction: inventory actual consumers, move semantic ownership to
Assistant, verify replacement journeys, then retire legacy tools through a
reviewed compatibility change. Do not remove them during a wording cleanup:
the prepared desktop Codex relay still tells clients to use `capture_note`.
Changing only labels will not finish this boundary.

### 3. Memory vocabulary is not yet consistent across all current surfaces

The UI redesign uses Memory, but current READMEs, connecting-client examples,
MCP descriptions and relay guidance still use Note/Capture as the main user
concept. Some instructions name buttons from older previews.

Proposed correction: update ordinary current-product copy to Memory and label
version-specific instructions honestly. Keep API names such as `capture_note`,
function/type names and the `./core` package alias until consumer compatibility
has been checked. Quoted history, original conversation titles and unrelated
uses of “note” are not rename targets.

### 4. Non-Latin capture filenames can lose their meaning

In [lib/index.mjs](../lib/index.mjs), `slug()` retains only `a-z0-9`. A fully
Cyrillic title therefore falls back to `capture` in the physical filename,
even when the title/content remains readable. Capture path discovery also
turns a listing failure into an empty list.

Proposed correction: preserve safe Unicode in new human-readable names, use
platform-safe filename rules, and propagate real listing errors. Retain
exclusive non-overwriting creation and test collisions/readback in fixtures.
Do not rename existing files, convert them to UTF-16, strip meaningful text or
rewrite malformed historical headers as part of this change.

**Resolved 30 October 2026** in `lib/index.mjs`. `slug()` now keeps Unicode
letters, numbers and combining marks (normalised NFC) and replaces only unsafe
characters, so a title in a non-Latin script keeps its readable words in the
filename instead of falling back to `...-capture.md`.
It slices by code point and keeps the documented `capture` fallback for a title
with no letters or digits. `capturePath()` no longer swallows listing failures
(`list()` already reports an absent folder as empty, so the extra catch only hid
real errors such as `EACCES`), and it compares collisions in one normal form
because macOS stores names decomposed. No existing file is renamed; the change
applies to new captures only. Five fixture checks were added to
`scripts/lib-smoke-test.mjs` (Cyrillic, Greek, traversal characters, empty title,
listing failure); `npm test` passes 46 library checks plus the MCP and import
suites.

### 5. Disabled Assistant code still ships in the UI source tree

The UI `proxy.ts` currently rejects `/api/resume`, `/api/today` and
`/api/transcript` with 404. Their older route implementations still contain
Assistant behaviour and direct disk access, including a fixed default root.

They are not evidence that the normal desktop screen is executing those flows:
the proxy blocks them. Proposed correction: verify imports/consumers and remove
or explicitly quarantine the obsolete implementations so later work cannot
accidentally re-enable them. Keep the independent Vault UI.

### 6. Tested local source is not the next downloadable release

The UI's `desktop/vault-dependency.json` still pins Vault `115c249`; both paired
worktrees contain uncommitted changes. The redesigned QA app was built from a
disposable working-tree package, not a clean public dependency pin.

Proposed correction: reconcile the intended changes, commit the selected Vault
source, update the normal dependency pin, choose a distinct preview version,
then run clean packaged/upgrade/real-client acceptance. Publishing, replacing an
installed app and changing account configuration remain separate approval gates.

### 7. Backup/restore and cross-platform UX remain release work

The existing backup script is an operator script, not a completed consumer
Google Drive/iCloud recovery flow. It keeps a latest ZIP, excludes `.trash`, and
its final remote check compares size rather than downloaded-back file hashes.
The current recoverable move requires filesystem hard-link support.

Proposed correction: prove a non-destructive restore into a temporary location,
make exclusions and unsupported filesystems clear, and build the agreed simple
Google Drive/iCloud experience incrementally. Do not add Backblaze or mandatory
second-target/encryption infrastructure just because an old roadmap lists it.
Windows/Linux application acceptance is separate from portable Markdown or an
earlier library CI result.

## Business facts, without inventing a legal entity

The checked-out Vault [LICENSE](../LICENSE) is FSL-1.1-ALv2 and names Kirill
Frolov as copyright holder. README uses Personal AI Systems as the product
identity. That does not prove a company registration, trademark or IP assignment.
No licence/account/ownership change was made by this review.

The paired UI checkout has no tracked LICENSE/COPYING file. Confirm and document
its intended licence coverage before the next public distribution; do not
silently assume the sibling repository's file resolves that question.

## Suggested next sequence

Each is a small slice with explicit acceptance, not a new ten-step database plan:

1. Align current instructions and checkpoints, preserving historical bodies.
   Done when a fresh agent finds Memory and the current ownership boundary first.
2. Align current product/help/MCP descriptive wording without renaming APIs.
   Done when the labels match the relevant installed/released version.
3. Fix new Unicode capture naming and visible error handling with disposable
   fixtures; no migration of old files.
4. Complete compatibility and approval-boundary tests before retiring semantic
   legacy tools or disabled Assistant implementations.
5. Resume the existing UI handoff: unsaved drafts, recovery ordering, previews,
   keyboard/platform acceptance, then a clean, distinctly versioned candidate.

The detailed existing UI checklist remains in the sibling
`personal-vault-ui/docs/simple-ui-redesign-handoff.md`; do not duplicate or
restart completed navigation/recovery work.

## What this review did not change

No existing memory, original conversation, folder layout, live service, client
registration, scheduler, credential, legal identity, release or Git history was
changed. This document is a review artifact, not evidence that its follow-ups
are already implemented. It is local/uncommitted; no publication or verified
cloud backup of this revision is claimed.
