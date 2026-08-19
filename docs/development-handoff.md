# Personal Vault Development Handoff

Status date: 19 August 2026  
Operating model: continuous delivery through evidence gates, without a calendar deadline

## Purpose

This document is the durable context for the canonical Personal Vault development chat. It summarizes the settled decisions from the 18-19 August architecture and product discussions, the verified repository state, known migration debt and the next work order.

For any conflict, `AGENTS.md` is the authoritative project brief. This handoff adds working context but does not override it.

## Verified Repository State

- GitHub organization: `Personal AI Systems` / `personal-ai-systems`.
- Core repository: <https://github.com/personal-ai-systems/personal-vault-core>.
- Visibility: private until a separately approved public-alpha change after the pre-public safety gate.
- Default branch: `main`.
- Local Core checkout: `/Users/kirill/development/personal/personal-vault-core`.
- Product-decision baseline before this handoff: `201f493` (`Define Personal AI Systems release direction`). Always verify the current `main` HEAD before starting work.
- `kir-au` is the active organization admin/owner and repository maintainer.
- The organization was created with the business details entered by the owner for Consense Beauty.
- Personal Assistant currently remains at <https://github.com/kir-au/personal-assistant> and `/Users/kirill/development/personal/personal-dashboard`. Moving it into the organization is not yet an approved decision.
- Live private data remains at `/Users/kirill/personal-vault`, outside Git.

## Settled Product Decisions

### Brand and ownership

- Umbrella and publishing brand: **Personal AI Systems**.
- User-facing product: **Personal Vault**.
- Technical repository/package: `personal-vault-core`.
- GitHub organization business association: **Consense Beauty**, as entered by the owner.
- Initial software copyright holder and licensor: **Kirill Frolov**, unless and until a separate legal assignment is documented. Creating a business-owned GitHub organization did not itself transfer copyright.

### Distribution and licence

- Direction: public source repository and public alpha after safety/release gates pass.
- Current visibility: private.
- Licence: **FSL-1.1-ALv2**.
- This is Fair Source/source-available, not OSI Open Source during the first two years of each version.
- Competing commercial use is restricted under FSL; each version becomes available under Apache 2.0 on the second anniversary of its publication.
- Commercial services may later be offered on top of the public product. Do not invent a cloud service, subscription or enterprise edition before the core journey is proven.

### Product form

- The target is a shippable, installable product for non-technical users, comparable in usability ambition to Obsidian rather than a developer-only MCP script.
- Core includes a thin, storage-oriented **Vault Browser**: browse records/files, preview and edit Markdown, capture, search, archive, recoverable trash, export, backup status and non-destructive restore.
- The Vault Browser must remain domain-neutral. It does not contain Health, Today, Planner, Trading or other Assistant dashboards and does not interpret record meaning.

### Backup direction

- Initial mass-market targets: **Google Drive** and **iCloud**.
- Backblaze is explicitly out of the initial scope.
- Backups must be encrypted and versioned, keep keys outside synced archives, include integrity manifests and support non-destructive restore.
- No provider is “supported” until a restore drill into a temporary location succeeds with hashes, missing-file detection and measured recovery time.

## Core/Assistant Boundary

The defining rule is:

> Personal Vault remains the physical, user-owned storage of data; Personal Assistant owns the meaning of that data.

Examples:

- A meal photo, Fitbit export or weight measurement may be stored in Core as a neutral source record with provenance and attachments.
- Calories consumed/burned, deficit, workout interpretation, goals, confidence labels, trends and medical conclusions belong only to Personal Assistant's Health module.
- Today, Planner, project dashboards, recommendations, model routing and autonomous workflows belong to Personal Assistant.
- Core must not understand calories, workout, Today, Planner, Health or project-specific public verbs.

The intended cross-product flow is:

```text
raw capture saved in readable form by Core
-> Assistant reads relevant source records
-> Assistant produces an evidence-linked interpretation/proposal
-> user explicitly approves a meaningful mutation
-> Core applies a generic, permission-checked mutation with provenance
-> canonical history remains inspectable and derived indexes remain rebuildable
```

## Canonical Data Rules

- Raw source material is never silently rewritten into a conclusion.
- Readable Markdown is preferred for notes, discussions, decisions and documents.
- Binary assets stay binary with readable metadata.
- Every derived artifact points to source record IDs and processor/version provenance.
- Indexes, caches and optional databases are derivatives and must be rebuildable.
- Meaningful mutations are explicit, auditable and approval-gated.
- Live Vault contents, backups, imports, credentials, tokens, keys and logs never enter the repository.

## Current Transitional Debt

The current `mcp/personal-vault-server.mjs` is not yet a neutral Core implementation. It still includes:

- `get_today_plan` and direct reads of Today/Health/project projections;
- Health activity classification and nutrition/calorie heuristics;
- project-routing heuristics and domain-specific capture proposal language;
- `add-today-achievement` and `add-to-today-plan` compatibility actions;
- Assistant/model-owned capture review execution through Codex;
- `apply_capture_action` forwarding to Personal Assistant via `DASHBOARD_BASE_URL`;
- structured search knowledge of `structured/health` and project-plan shapes;
- a Core package version of `0.1.0` while the MCP runtime reports `0.1.1`;
- no demonstrated Core contract v1, stable record/change-cursor model, complete audit contract, CLI suite, migration framework, backup/restore implementation, CI evidence or multi-device proof;
- a possible append-only collision risk because capture filenames are deterministic;
- attachment decoding that currently permits only image MIME types despite broader asset goals;
- Google token validation that is a compatibility authentication layer, not a complete durable OAuth 2.1 provider.

Do not remove compatibility behavior first and repair clients afterward. Required order:

```text
add Assistant-owned equivalent
-> add compatibility fixtures/tests and rollback
-> verify mobile ChatGPT connector without changing its public URL
-> switch callers
-> observe compatibility
-> remove Core adapter/domain logic
```

## Continuous Delivery and Evidence Gates

1. **Gate 1 — boundary, inventory and contracts:** ownership matrix, dependency graph, Core contract v1, compatibility fixtures, rollback steps, Vault Browser boundary and pre-public checklist.
2. **Gate 2 — neutral runnable Core:** generic CLI and contracts, Assistant extraction, clean fixture install and first Vault Browser slice.
3. **Gate 3 — encryption, backup and recovery:** threat model, Google Drive/iCloud encrypted adapters, manifests, retention and two restore drills.
4. **Gate 4 — multi-device and Assistant integration:** explicit writer/conflict policy, versioned compatibility, selected end-to-end journey through public Core contracts, CI and approval controls.
5. **Gate 5 — release candidate:** clean install/upgrade/recovery/connector tests, documentation, redacted demo Vault, release checklist and evidence-based ship/no-ship decision.

Do not declare a gate complete from documentation alone. Keep executed evidence, fixtures, hashes, test output and recovery reports.

Development should continue in this canonical Codex task whenever an approved bounded task and a working model/provider account are available. There is no separate development runner, control-plane repository or external service. After each verified step, Codex reports here and waits for the user's review and approval before picking up the next roadmap step. A provider or rate limit is a safe pause: preserve the repository state and resume in this same task after the user restores access or switches account.

## Immediate Work Order for the New Development Chat

1. Read `AGENTS.md`, `README.md`, this context, `docs/personal-vault-fluid-capture.md`, the MCP server and schema before proposing changes.
2. Produce an ownership matrix for every extracted/shared path and every registered MCP tool: Core, Assistant, compatibility adapter, migration-only or obsolete.
3. Inventory all reverse dependencies from Core to Personal Assistant and all consumers of current MCP tools.
4. Define Core contract v1: stable record IDs, generic record envelope, asset descriptors, provenance, audit events, search results, change cursor and approved mutation envelope.
5. Add temporary-fixture contract tests and rollback fixtures before moving or deleting behavior.
6. Introduce Assistant-owned equivalents for Today plan, capture review/interpretation and approved domain updates.
7. Migrate and verify the mobile ChatGPT connector while preserving the public connector URL.
8. Only then remove Health/calorie/workout, Today/Planner/project heuristics and `DASHBOARD_BASE_URL` from Core.
9. Freeze the record/mutation contract before building the Vault Browser beyond a minimal read-only spike.

The Gate 1 ownership/dependency inventory is recorded in `docs/ownership-matrix.md`. The next bounded slice is the reviewed Core contract v1 design; do not begin implementation, UI, backup claims or public release before that contract is approved.

## Working Rules for the Dedicated Development Chat

- Treat this chat as the canonical Personal Vault development chat.
- Keep the entire development loop in this Codex task. Do not create a separate runner repository, external control plane or parallel task owner.
- After completing and verifying one approved bounded step, report here and wait for the user's review before beginning the next step.
- Start each substantial task by reading current repository instructions and verifying current Git/GitHub state; do not rely only on this handoff.
- Ask only questions that remain genuinely unresolved. Do not reopen the Core/Assistant boundary, brand, FSL direction, Google Drive/iCloud targets or the existence of the thin Vault Browser without new evidence.
- Preserve compatibility and source material. Never mutate the live Vault as part of repository tests; use temporary redacted fixtures.
- Separate verified current facts from plans and unexecuted claims.
- Update `AGENTS.md` and this handoff when a durable decision changes. Commit narrowly with tests/evidence appropriate to the risk.
- Public visibility, destructive operations, credentials, medical/financial actions and legal ownership changes require separate explicit authorization.

## Still Open

- Whether and when `kir-au/personal-assistant` moves into the Personal AI Systems organization.
- Whether copyright/licensor ownership should later be formally assigned from Kirill Frolov to a legal entity.
- Exact packaging and supported desktop/mobile operating-system matrix for the first public alpha.
- Exact two-device acceptance pair and the initial writer/conflict-resolution model.
- Exact encryption/key-recovery UX and provider-specific Google Drive/iCloud adapter design.
- Which single end-to-end Assistant journey will be the Gate 4 acceptance path.

Resolve these only when they block the current Gate 1 work or materially affect a contract.

## Evidence Already Obtained

- Repository transfer to `personal-ai-systems/personal-vault-core` completed with history preserved.
- Remote `origin` uses `git@github.com:personal-ai-systems/personal-vault-core.git`.
- GitHub repository was verified private on 19 August 2026.
- Commit `201f493` is on `main` and contains the brand, product boundary, FSL licence direction, Vault Browser scope and Google Drive/iCloud backup direction.
- The repository page, owner, private badge and latest commit were visually verified in the actual macOS Google Chrome application.
- `git diff --check`, JavaScript syntax validation, package metadata parsing and dependency-tree validation passed for commit `201f493`.
- Gate 1 path/tool ownership, reverse dependencies, known consumers and transitional MCP behavior were inventoried in `docs/ownership-matrix.md` against Core baseline `f56b0c6`; no compatibility code was removed or restarted.

This evidence does not prove runtime MCP behavior, mobile connector compatibility, security readiness, backup/restore, clean installation or multi-device operation. Those remain future acceptance work.
