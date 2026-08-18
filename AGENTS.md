# Personal Vault Core Project Instructions

This file is the authoritative project brief for humans and coding agents working in this repository. Read it before planning or changing code.

## Mission

Personal Vault Core is a neutral, user-owned knowledge and data layer. It preserves information durably, keeps it human-readable where practical, records provenance and mutation history, and exposes stable generic interfaces to consumers.

Core is not a personal assistant, planner, health application, trading application, or project dashboard. Those products consume Core through versioned contracts.

The primary consumer is Personal Assistant:

- repository: `kir-au/personal-assistant`;
- local checkout during the initial migration: `/Users/kirill/development/personal/personal-dashboard`;
- responsibilities: Today, Planner, project dashboards, recommendations, domain interpretation, agent workflows and approval UI.

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
- packaging, installation, upgrade and recovery documentation.

### Core must not own

- calories consumed, calories burned, calorie deficit or weight-loss targets;
- exercise prescriptions, workout progression or medical recommendations;
- Today agendas, weekly priorities, Planner projections or carry-over policy;
- Health, Wealth, Trading, Family or Business dashboards;
- project-specific routing rules or public project-specific tools;
- recommendation generation, model routing or autonomous agent orchestration;
- React, Next.js or another consumer UI framework;
- a second application-owned copy of canonical records.

Domain applications may store their source records in Core, but Core must remain unaware of their meaning. For example, a meal photo, Fitbit export or weight measurement may be stored as a generic record with provenance and attachments. Personal Assistant's Health module owns the health schema, calorie calculations, confidence labels, trends, goals and UI. Core stores and retrieves the record; Health interprets it.

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

## Current State — 18 August 2026

- The repository has been extracted and is available at `kir-au/personal-vault-core`.
- The live Vault remains at `/Users/kirill/personal-vault` and is not part of Git.
- The generic MCP process is launched from this repository and remains publicly reachable through the existing authenticated connector.
- Personal Assistant is a separate repository and continues to serve the dashboard and domain APIs.
- The current MCP implementation still contains transitional Health, nutrition, project-routing and Today-plan logic, plus a temporary `DASHBOARD_BASE_URL` adapter. This is migration debt, not the desired architecture.
- The first release must preserve compatibility while that debt is removed behind versioned contracts and tests.

## Roadmap to 31 December 2026

### Gate 1 — Boundary, inventory and contracts

Target: August.

- Maintain an ownership matrix for every extracted or shared path: Core, Assistant, adapter, migration-only or obsolete.
- Freeze the generic record, asset, provenance, audit, search and MCP/API contracts.
- Define compatibility fixtures and a rollback procedure before removing transitional behavior.
- Document which current tools are Core tools and which are Assistant compatibility tools.

Exit evidence: reviewed ownership matrix, dependency graph, versioned contract, compatibility tests and rollback steps.

### Gate 2 — Neutral runnable Core

Target: September.

- Remove Health, nutrition, calorie, Today, Planner and project heuristics from Core.
- Move domain interpretation and proposal generation to Personal Assistant processors.
- Replace the reverse Core-to-Assistant HTTP dependency with a clean consumer contract or event/subscription mechanism.
- Add CLI commands for init, validate, capture, read, search, export and rebuild-indexes.
- Prove a clean install against a redacted fixture Vault without Personal Assistant.

Exit evidence: a clean environment can capture, retrieve, search, rebuild and export generic records without Next.js, domain schemas or a model provider.

### Gate 3 — Encryption, backup and recovery

Target: October.

- Define the threat model and encryption boundary.
- Keep encryption keys outside synced archives.
- Produce encrypted, versioned Google Drive backups and a second independent backup.
- Add integrity manifests, retention rules and a non-destructive restore workflow.
- Run restore drills from both targets into temporary locations.

Exit evidence: two successful restore reports with hashes, missing-file detection and measured recovery time.

### Gate 4 — Multi-device and Assistant integration

Target: November.

- Support at least two devices with explicit single-writer or conflict-resolution rules.
- Version API/MCP compatibility and migrations.
- Make Personal Assistant use only the public Core contract for the selected end-to-end journey.
- Add provenance, permissions, budgets, timeouts and approval gates to Assistant agent workflows.
- Add CI checks for contract compatibility, secret scanning and restore fixtures.

Exit evidence: capture to evidence-linked interpretation to approved mutation works across two devices with one canonical history.

### Gate 5 — Release candidate

Target: December.

- Complete install, upgrade, security, backup, restore and troubleshooting documentation.
- Build a redacted demo Vault and deterministic end-to-end tests.
- Finalize licence and public/private repository boundaries.
- Run clean-install, upgrade, corruption-recovery and connector tests.
- Tag a release candidate and make an evidence-based ship/no-ship decision by 31 December.

Exit evidence: reproducible package, tested documentation, release notes and signed release checklist.

## Immediate Work Order

1. Write the ownership matrix and identify all transitional domain behavior in `mcp/personal-vault-server.mjs`.
2. Define Core contract v1 with stable IDs, generic record envelopes, assets, provenance, audit events and search results.
3. Add contract tests that run against a temporary fixture Vault.
4. Introduce Assistant-owned endpoints for Today plan, capture interpretation and approved domain updates.
5. Migrate the mobile ChatGPT flow without changing the public connector URL.
6. Remove Health/calorie/workout and Planner/project interpretation from Core after compatibility tests pass.
7. Remove `DASHBOARD_BASE_URL` from Core when no caller depends on the adapter.

Do not remove compatibility behavior first and repair consumers afterward. The migration order is: add the consumer capability, verify it, switch callers, observe, then remove the adapter.

## Engineering Rules

- Prefer explicit, versioned contracts over shared filesystem assumptions.
- Keep changes narrow and add tests in proportion to blast radius.
- Never read or write outside the configured Vault root except through an explicitly documented integration.
- Never turn imported claims into trusted facts merely because they came from an integration or AI model.
- Preserve source references through every transformation.
- Require explicit approval for meaningful mutations and separate authorization for destructive, financial, medical, credential or public actions.
- Do not claim backup, restore, multi-device or security readiness without executed acceptance evidence.
- Do not add a competitor feature unless it supports the selected end-to-end user journey.

## Definition of Done for Core

Core is independently successful when it can be installed without Personal Assistant, open or initialize a Vault, store a generic record and assets, retrieve and search it, rebuild all indexes, export it, validate integrity and restore it from documented backups. No test or runtime path should require Health, Planner, project dashboards, Next.js or a specific AI provider.
