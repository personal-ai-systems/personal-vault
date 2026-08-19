# Personal Vault Contract v1

Status: draft

- Contract version: `personal-vault/v1`
- Machine-readable schema: [`contracts/v1/personal-vault.schema.json`](../contracts/v1/personal-vault.schema.json)

This document defines the public, storage-neutral contract for Personal Vault. It is intentionally small: records, assets, provenance, approved mutations, audit events, search and change feeds.

## Principles

1. Records have stable opaque identifiers; paths and filenames are never public identities.
2. Source material is preserved. Derived material identifies its sources and processor version.
3. Mutations are explicit, approval-backed, idempotent and audited.
4. Record meaning is opaque to Personal Vault. It validates the envelope, access policy and integrity—not application interpretation.
5. Indexes and caches are rebuildable derivatives, not the only recoverable source of data.

## Record envelope

Every stored record includes:

- `contractVersion: "personal-vault/v1"`;
- `recordId`, `revision` and lifecycle `state`;
- creation and update timestamps plus the creating actor;
- privacy label, optional title and readable content;
- provenance, asset references and namespaced metadata.

Metadata keys use a dotted namespace such as `vault.source` or `client.import-id`. Personal Vault validates key shape but treats metadata values as opaque.

## Provenance

Provenance identifies how material entered the Vault:

- `origin`: `direct`, `import`, `derivation`, `migration` or `recovery`;
- `capturedAt` and `capturedBy`;
- optional source locator and source hash;
- source record IDs and processor identity for derivations.

The Vault preserves provenance. It does not convert an imported claim, integration response or generated text into a trusted fact.

## Approved mutations

The `approvedMutation` envelope contains a mutation ID, request timestamp and actor, idempotency key, approval evidence, operation and provenance.

V1 operations are:

| Operation | Result |
| --- | --- |
| `record.create` | Creates revision 1 of a record. |
| `record.revise` | Creates the next revision after checking `baseRevision`. |
| `record.archive` | Marks a record archived. |
| `record.restore` | Returns a record to active state. |
| `record.trash` | Moves a record to recoverable trash. |
| `asset.attach` | Adds a content-addressed asset and creates a record revision. |

The service rejects unsupported versions, expired approval, unauthorized actors, revision conflicts, integrity failures and conflicting reuse of an idempotency key.

## Audit and change feed

Each accepted mutation creates one audit event with an event ID, sequence, action, actor, resource, resulting revision and provenance.

`vault.changes.list` accepts an opaque cursor and returns ordered events, a `nextCursor` and `hasMore`. Consumers process events idempotently by `eventId`; a cursor reset triggers re-synchronization.

## MCP/API operations

| Capability | Operation |
| --- | --- |
| Create record | `vault.records.create` |
| Attach asset | `vault.assets.attach` |
| Read record | `vault.records.get` |
| Search records | `vault.records.search` |
| List changes | `vault.changes.list` |
| Apply a generic mutation | `vault.mutations.append` |

Validate, export and index rebuild operations are reserved until their fixture-based acceptance tests are added.

## Deferred work

- physical record and asset layout beyond the readable record representation;
- encryption key management, backup archive format and restore workflow;
- synchronization and concurrent-writer policy;
- retention and permanent-purge policy;
- durable authorization-server configuration;
- vector indexing and ranking.

Deferred work may not add interpretation-specific public methods to this contract.
