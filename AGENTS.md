# Personal Vault Project Instructions

This file is the authoritative project brief for humans and coding agents working in this repository. Read it before planning or changing code.

## Mission

Personal Vault is a neutral, user-owned knowledge and data product published under the Personal AI Systems project brand. It preserves information durably, keeps it human-readable where practical, records provenance and mutation history, and exposes stable generic interfaces to consumers.

Core is not a personal assistant, planner, health application, trading application, or project dashboard. Those products consume Core through versioned contracts.

The primary consumer is Personal Assistant:

- repository: `kir-au/personal-assistant`;
- local checkout during the initial migration: `/Users/kirill/development/personal/personal-dashboard`;
- responsibilities: Today, Planner, project dashboards, recommendations, domain interpretation, agent workflows and approval UI.

## Repository and Workspace Map

- Repository: `personal-ai-systems/personal-vault` at <https://github.com/personal-ai-systems/personal-vault>;
- Local checkout: `/Users/kirill/development/personal/personal-vault`;
- Personal Assistant repository: `kir-au/personal-assistant` at <https://github.com/kir-au/personal-assistant>;
- Personal Assistant local checkout during migration: `/Users/kirill/development/personal/personal-dashboard`;
- separately provisioned live Vault: `/Users/kirill/personal-vault`;
- durable development context: `docs/development-handoff.md`;
- Gate 1 ownership and dependency inventory: `docs/ownership-matrix.md`.
- Proposed Core v1 contract: `docs/core-contract-v1.md` and `contracts/v1/core-contract-v1.schema.json`.

The repository moved from `kir-au/personal-vault-core` to the Personal AI Systems GitHub organization on 19 August 2026, then was renamed to `personal-ai-systems/personal-vault` with history preserved. The local checkout and configured LaunchAgent use the matching `personal-vault` path. The Assistant repository has not yet been moved; do not assume that decision has been made.

## Product Boundary

### Core owns

- canonical records and attached assets;
- raw capture with exact source text and timestamps;
- generic metadata, provenance and privacy labels;
- append-only audit and mutation history;
- rebuildable full-text, metadata and optional vector indexes;
- generic record retrieval and search;
- import, export, validation and schema-version migration infrastructure;
- authentication, authorization and stable MCP/API transport;
- encrypted backup, integrity manifests and non-destructive restore;
- a thin, storage-oriented Vault Browser for browsing, Markdown preview and editing, capture, search, archive, recoverable trash, export, backup status and restore;
- packaging, installation, upgrade and recovery documentation.

### Core must not own

- calories consumed, calories burned, calorie deficit or weight-loss targets;
- exercise prescriptions, workout progression or medical recommendations;
- Today agendas, weekly priorities, Planner projections or carry-over policy;
- Health, Wealth, Trading, Family or Business dashboards;
- project-specific routing rules or public project-specific tools;
- recommendation generation, model routing or autonomous agent orchestration;
- domain dashboards, recommendations or workflow-specific UI inside the storage-oriented Vault Browser;
- a second application-owned copy of canonical records.

Domain applications may store their source records in Core, but Core must remain unaware of their meaning. For example, a meal photo, Fitbit export or weight measurement may be stored as a generic record with provenance and attachments. Personal Assistant's Health module owns the health schema, calorie calculations, confidence labels, trends, goals and UI. Core stores and retrieves the record; Health interprets it.

The Vault Browser is part of Core because Core must be useful to a non-technical person without Personal Assistant or an AI model. Its UI reflects records, folders, assets, versions, provenance, backup and restore state. It must not infer domain meaning or become a second Personal Assistant.

## Brand, Licence and Public Release Direction

- `Personal AI Systems` is the umbrella project and publishing brand.
- `Personal Vault` is the user-facing product, repository and package name: `personal-vault`.
- `Core` names the neutral storage/API layer within Personal Vault; it is not a second product or repository name.
- Kirill Frolov is the initial copyright holder and licensor unless ownership is formally assigned to a legal entity later.
- The repository uses `FSL-1.1-ALv2`: source is visible and available for permitted purposes, competing commercial use is restricted, and each released version receives the Apache License 2.0 on the second anniversary of its publication.
- This is Fair Source/source-available software, not OSI Open Source before the future licence takes effect.
- The target is a public alpha after the pre-public safety gate passes. Changing GitHub visibility is a separate approved release action, not an automatic consequence of updating this document.

The pre-public safety gate requires, at minimum: full Git history secret/PII scanning, a redacted fixture Vault, reproducible installation, basic contract and security tests, `SECURITY.md`, clear alpha limitations, and confirmation that no live Vault contents, credentials, backups, imports or logs are present in the repository or its history.

## Canonical Data Rules

1. Raw source material is never silently rewritten into a derived conclusion.
2. Every derived artifact links to its source record IDs and the processor/version that produced it.
3. Derived indexes and caches must be rebuildable.
4. Mutations are explicit, auditable and permission-checked.
5. Domain meaning belongs to the consumer that defines the domain schema.
6. Secrets, OAuth tokens, private keys, live Vault contents, backups, imports and logs are never committed to this repository.
7. The live data directory remains separately provisioned. Repository code must not assume that it is inside the checkout.

Readable Markdown remains the preferred canonical representation for notes, conversations, decisions and documents. Binary assets remain binary with readable metadata. An internal database may accelerate retrieval, locking or indexing, but it must not become the only recoverable source of user data.

## Interface Direction

The stable Core interface should be small and generic. Target capabilities include:

- create a record or capture;
- attach and retrieve assets;
- read a record by stable ID;
- search records and return source references;
- list changes since a cursor;
- append an approved, generic mutation with provenance;
- export, validate, rebuild indexes and restore.

Tools such as `get_today_plan`, Health-specific capture interpretation, calorie questions and workout updates belong to Personal Assistant. They may temporarily remain in the current MCP server only as compatibility adapters while equivalent Assistant endpoints are deployed and clients are migrated.

Public contracts must not grow methods such as `log_health_workout`, `calculate_calorie_deficit`, `add_business_task` or similar domain verbs. Consumers may use namespaced metadata internally, but Core validates only the generic envelope and access policy.

## Current State — 19 August 2026

- The repository is available at `personal-ai-systems/personal-vault`; `main` is the default branch.
- The GitHub organization display name is Personal AI Systems. `kir-au` is its active admin/owner. The organization was created using the business details entered by the owner for Consense Beauty.
- The GitHub organization setting does not by itself transfer software copyright or licensing rights. Kirill Frolov remains the initial copyright holder and FSL licensor until a separate formal assignment is documented.
- The live Vault remains at `/Users/kirill/personal-vault` and is not part of Git.
- The generic MCP process is launched from this repository and remains publicly reachable through the existing authenticated connector.
- Personal Assistant is a separate repository and continues to serve the dashboard and domain APIs.
- The current MCP implementation still contains transitional Health, nutrition, project-routing and Today-plan logic, plus a temporary `DASHBOARD_BASE_URL` adapter. This is migration debt, not the desired architecture.
- The first release must preserve compatibility while that debt is removed behind versioned contracts and tests.
- The GitHub repository remains private until the pre-public safety gate is executed; public source is the approved direction.
- Personal AI Systems is the approved umbrella brand, with Kirill Frolov as the initial copyright holder.
- FSL-1.1-ALv2 is the approved source-available licence.
- Google Drive and iCloud are the initial mass-market backup targets. Neither target is considered ready until an encrypted archive has been restored successfully from it.
- This is the canonical Personal Vault development chat. Durable decisions made here must be reflected back into this repository rather than existing only in chat history.

## Continuous Development Operating Model

Development is continuous and evidence-gated, not deadline-gated. This canonical Codex task/chat is the operating surface. Do not create a separate development-runner repository, external control plane or product runtime for this workflow.

The normal human-in-the-loop cycle is:

```text
read the current instructions, roadmap and repository state
-> identify one next bounded step
-> request approval in this Codex task
-> implement the approved step in the current repository
-> run deterministic checks
-> report the exact diff, evidence and remaining risk in this task
-> wait for the user's review and approval
-> pick up the next roadmap step
```

The workflow continues in this task whenever the user has approved the next step and Codex is available. A built-in Codex heartbeat may be used only as a wake-up for this same task after the user approves its cadence; it must not create another repository, a parallel development owner or an external runner. The workflow does not depend on a scheduler: an approval gate intentionally pauses work until the user responds here.

An approved work package may contain multiple safe, reversible implementation subtasks. Separate approval is still required before public releases, destructive changes, credential creation or expansion, legal ownership changes, production migrations and contract-breaking compatibility changes. If a provider limit, rate limit or account interruption stops work, preserve the repository state, report the stop here and resume in this task after the user restores access or switches account. Codex must not inspect billing, calculate remaining credits, purchase credits or manage provider accounts.

## Continuous Evidence Gates

### Gate 1 — Boundary, inventory and contracts

Sequence: current product-development gate.

- Maintain an ownership matrix for every extracted or shared path: Core, Assistant, adapter, migration-only or obsolete.
- Freeze the generic record, asset, provenance, audit, search and MCP/API contracts.
- Define compatibility fixtures and a rollback procedure before removing transitional behavior.
- Document which current tools are Core tools and which are Assistant compatibility tools.
- Freeze the storage-oriented Vault Browser boundary and its safe file operations.
- Complete the pre-public safety gate and prepare a separately approved public-alpha visibility change.

Exit evidence: reviewed ownership matrix, dependency graph, versioned contract, compatibility tests, rollback steps, Vault Browser boundary and a signed pre-public checklist.

### Gate 2 — Neutral runnable Core

Sequence: after Gate 1 exit evidence is complete.

- Remove Health, nutrition, calorie, Today, Planner and project heuristics from Core.
- Move domain interpretation and proposal generation to Personal Assistant processors.
- Replace the reverse Core-to-Assistant HTTP dependency with a clean consumer contract or event/subscription mechanism.
- Add CLI commands for init, validate, capture, read, search, export and rebuild-indexes.
- Add the thin Vault Browser with Markdown preview/editing, capture, search, archive, recoverable trash, export and backup/restore status.
- Prove a clean install against a redacted fixture Vault without Personal Assistant.

Exit evidence: a non-technical user can install Core, browse a fixture Vault, capture and edit Markdown, retrieve and search records, archive and recover an item, rebuild indexes and export without Personal Assistant, domain schemas or a model provider.

### Gate 3 — Encryption, backup and recovery

Sequence: after the neutral Core contract and fixture workflow are stable.

- Define the threat model and encryption boundary.
- Keep encryption keys outside synced archives.
- Produce encrypted, versioned backups to Google Drive and iCloud through provider adapters.
- Add integrity manifests, retention rules and a non-destructive restore workflow.
- Run restore drills from both targets into temporary locations.

Exit evidence: two successful restore reports with hashes, missing-file detection and measured recovery time.

### Gate 4 — Multi-device and Assistant integration

Sequence: after backup/recovery behavior is reproducible.

- Support at least two devices with explicit single-writer or conflict-resolution rules.
- Version API/MCP compatibility and migrations.
- Make Personal Assistant use only the public Core contract for the selected end-to-end journey.
- Add provenance, permissions, budgets, timeouts and approval gates to Assistant agent workflows.
- Add CI checks for contract compatibility, secret scanning and restore fixtures.

Exit evidence: capture to evidence-linked interpretation to approved mutation works across two devices with one canonical history.

### Gate 5 — Release candidate

Sequence: after the earlier gates have executable evidence.

- Complete install, upgrade, security, backup, restore and troubleshooting documentation.
- Build a redacted demo Vault and deterministic end-to-end tests.
- Verify ongoing FSL, attribution, trademark and public-release compliance.
- Run clean-install, upgrade, corruption-recovery and connector tests.
- Tag release candidates whenever the full checklist passes and make each ship/no-ship decision from current evidence.

Exit evidence: reproducible package, tested documentation, release notes and signed release checklist.

## Immediate Work Order

1. Maintain the reviewed ownership matrix and transitional behavior inventory in `docs/ownership-matrix.md` as paths and tools change.
2. Review the proposed Core v1 record, asset, provenance, audit, search, cursor and mutation contract; after approval, incompatible changes require a new contract version.
3. Add contract tests that run against a temporary fixture Vault.
4. Introduce Assistant-owned endpoints for Today plan, capture interpretation and approved domain updates.
5. Migrate the mobile ChatGPT flow without changing the public connector URL.
6. Remove Health/calorie/workout and Planner/project interpretation from Core after compatibility tests pass.
7. Remove `DASHBOARD_BASE_URL` from Core when no caller depends on the adapter.
8. Build the first storage-oriented Vault Browser slice only after the record and mutation contracts are frozen.

Do not remove compatibility behavior first and repair consumers afterward. The migration order is: add the consumer capability, verify it, switch callers, observe, then remove the adapter.

## Engineering Rules

- Prefer explicit, versioned contracts over shared filesystem assumptions.
- Keep changes narrow and add tests in proportion to blast radius.
- Never read or write outside the configured Vault root except through an explicitly documented integration.
- Never turn imported claims into trusted facts merely because they came from an integration or AI model.
- Preserve source references through every transformation.
- Require explicit approval for meaningful mutations and separate authorization for destructive, financial, medical, credential or public actions.
- Archive and recoverable trash are the default removal operations; permanent deletion requires separate authorization and auditable evidence.
- Do not claim backup, restore, multi-device or security readiness without executed acceptance evidence.
- Do not add a competitor feature unless it supports the selected end-to-end user journey.

## Definition of Done for Core

Core is independently successful when a non-technical user can install it without Personal Assistant, open or initialize a Vault in the thin Vault Browser, store and safely edit a generic record and assets, retrieve and search it, archive and recover it, rebuild all indexes, export it, validate integrity and restore encrypted backups from both Google Drive and iCloud. No test or runtime path should require Health, Planner, project dashboards or a specific AI provider.
