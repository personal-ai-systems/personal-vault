# Personal Vault Development Guide

Read this file before changing this repository.

## Mission

Personal Vault is a neutral, user-owned storage product for readable records, assets, provenance and durable history. It is published by Personal AI Systems.

The product stores information and exposes generic interfaces. It does not interpret application meaning, schedule work, generate recommendations, route models or provide application-specific workflows.

## Ownership

Personal Vault owns:

- canonical records and attached assets;
- raw capture, timestamps, privacy labels and provenance;
- append-only audit history and rebuildable indexes;
- generic retrieval, search, import, export, validation and migration infrastructure;
- authentication, authorization and stable MCP/API transport;
- encrypted backup, integrity manifests and non-destructive restore;
- a thin Vault Browser for records, Markdown preview/editing, capture, search, archive, recoverable trash, export, backup status and restore.

Personal Vault does not own interpretation-specific schemas, calculations, planning, recommendations, model orchestration or workflow-specific user interfaces.

## Public contract

- Product, repository and package: `personal-vault`.
- Contract version: `personal-vault/v1`.
- Public operation namespace: `vault.*`.
- Contract document: `docs/personal-vault-contract-v1.md`.
- Machine-readable schema: `contracts/v1/personal-vault.schema.json`.

Do not introduce public methods that encode an application's meaning. Keep records and metadata generic, namespaced and provenance-linked.

## Data rules

1. Preserve source material; never silently turn it into a conclusion.
2. Link derived material to source record IDs and processor/version provenance.
3. Keep Markdown readable where practical and binary assets binary with readable metadata.
4. Keep indexes and caches rebuildable.
5. Make meaningful mutations explicit, audited and permission-checked.
6. Never commit live data, credentials, tokens, private keys, backups, imports or logs.
7. Never run tests against a live Vault. Use a temporary redacted fixture.

## Development workflow

1. Read the current instructions, contract and repository state.
2. Select one bounded, reversible change.
3. Implement it with fixture-based checks.
4. Report the exact diff and remaining risk in the canonical development task.
5. Wait for review before starting the next externally visible or compatibility-affecting change.

Separate approval is required before public releases, destructive operations, credential changes, legal changes or production migrations.

## Release evidence

Do not claim release readiness without executed evidence for:

- clean installation against a redacted fixture;
- readable records, safe edits, archive and recovery;
- contract compatibility and security checks;
- encrypted backup and restore drills;
- multi-device writer/conflict behavior;
- secret and private-data scanning of the full history.

## Definition of done

Personal Vault is independently successful when a non-technical user can install it, initialize or open a Vault, store and safely edit generic records and assets, retrieve and search them, archive and recover an item, rebuild indexes, export data, validate integrity and restore encrypted backups. No runtime path may require a particular application domain or AI provider.
