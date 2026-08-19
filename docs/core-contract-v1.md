# Personal Vault Contract v1

- Status: proposed v1 design for Gate 1 review
- Contract version: `pv-core/v1`
- Machine-readable definitions: [`contracts/v1/core-contract-v1.schema.json`](../contracts/v1/core-contract-v1.schema.json)
- Scope: neutral records, assets, provenance, approved mutations, audit events, search results and change feeds

This contract defines the public semantic boundary for Personal Vault's neutral Core layer. It does not change the running MCP server yet. Existing tools remain available as compatibility behavior until Assistant replacements, fixture tests, rollback evidence and mobile-connector verification exist.

## Non-goals

Contract v1 does not define Health, nutrition, exercise, medical meaning, Today, Planner, projects, recommendations, model choice, agent orchestration or consumer UI. A consumer may preserve its own namespaced metadata and provenance in Core, but Core never uses those values to infer an action or expose a domain-specific public verb.

## Normative terms

The words **MUST**, **MUST NOT**, **SHOULD** and **MAY** are normative.

- A **record** is the neutral, versioned representation of a piece of user-owned information.
- An **asset** is an attached binary object, addressed independently from its filesystem location.
- A **revision** is an immutable record state. Editing creates a new revision; it never silently rewrites a prior revision.
- A **mutation** is a requested generic state change that has explicit approval and idempotency protection.
- An **audit event** is an append-only account of an accepted mutation.
- **Provenance** says where an item came from and which sources/process produced it; it does not make imported or model-generated claims trusted facts.
- A **cursor** is opaque to consumers. They MUST persist and resend it unchanged, and MUST NOT parse it for business meaning.

## Version and identifiers

Every public v1 envelope MUST carry `contractVersion: "pv-core/v1"`.

Core allocates stable, opaque ULID-based identifiers. Clients MUST NOT construct them or derive meaning from them.

| Resource | Prefix | Pattern |
| --- | --- | --- |
| Record | `pvr_` | `pvr_` plus a 26-character Crockford ULID |
| Asset | `pva_` | `pva_` plus a 26-character Crockford ULID |
| Mutation | `pvm_` | `pvm_` plus a 26-character Crockford ULID |
| Audit event | `pve_` | `pve_` plus a 26-character Crockford ULID |

Paths and filenames are implementation details. They are not record identifiers, external API references or authorization handles. A `record.create` request contains a record draft; Core allocates the record ID, revision and creation timestamps in its response. An `asset.attach` request similarly contains an asset draft and bytes; Core allocates the asset ID.

## Canonical representation

Readable Markdown is the preferred canonical form for notes, captures, conversations, decisions and documents. In v1, text record content is either `markdown` or `plain-text`; its SHA-256 digest is stored as `sha256:<lowercase-hex>`.

Binary material is stored as an asset with its own content hash, media type, byte length, provenance and optional original filename. A record references assets by `assetId`; Core MAY choose any safe physical layout and MAY rebuild indexes from canonical records/assets.

Record state is one of:

- `active` — normal readable state;
- `archived` — retained but not normal active browsing;
- `trashed` — recoverable removal state.

Contract v1 has no permanent-delete operation. A permanent deletion policy, if ever required, must be a separately approved, auditable contract version.

## Record envelope

A record MUST include a stable `recordId`, revision, timestamps, creator, privacy label, content, provenance, asset references and generic metadata. `title` is optional presentation metadata, not a domain classification.

```json
{
  "contractVersion": "pv-core/v1",
  "recordId": "pvr_01JH1P8N1S8Y3RFJ3R02P2V76K",
  "revision": 1,
  "state": "active",
  "createdAt": "2026-08-19T04:00:00.000Z",
  "updatedAt": "2026-08-19T04:00:00.000Z",
  "createdBy": { "kind": "user", "id": "user:local" },
  "privacy": "private",
  "title": "Capture",
  "content": {
    "format": "markdown",
    "text": "# Capture\n\nExact source text.",
    "hash": "sha256:2b90e17c0f9e12279945e139260066480586b233708d358229c09f21f6bf61af"
  },
  "provenance": {
    "origin": "direct",
    "capturedAt": "2026-08-19T04:00:00.000Z",
    "capturedBy": { "kind": "user", "id": "user:local" }
  },
  "assetRefs": [],
  "metadata": {
    "core.source": "mobile-capture"
  }
}
```

`metadata` keys MUST be namespaced (`vendor.key` or a deeper dotted name). Core validates key shape, authorization and privacy policy, but treats values as opaque consumer data. A consumer cannot make Core understand a domain by placing a domain word in metadata.

## Asset envelope

An asset MUST be content-addressed by its digest and use an opaque `assetId`. It MUST NOT expose a filesystem path as its stable public identity. An `asset.attach` mutation supplies an `assetDraft` and a `base64` payload; Core verifies the payload byte length and SHA-256 hash before allocating the asset ID. A record attachment has an `assetReference` with a neutral role (`attachment`, `preview`, `source` or `derived`).

Asset bytes are never rewritten in place. Replacing bytes creates a new asset and an audited record revision that refers to the new asset.

## Provenance

Every record, asset, mutation and optional audit event provenance carries:

- `origin`: `direct`, `import`, `derivation`, `migration` or `recovery`;
- `capturedAt` and `capturedBy`;
- optional `sourceLocator` and `sourceHash` for imported/source material;
- for `derivation`, non-empty `sourceRecordIds` and `processor.id`/`processor.version`.

Core preserves provenance but does not determine whether a source, integration or model output is true. Consumers must retain confidence, interpretation and domain claims in their own records or metadata with source references.

## Approved generic mutations

All state changes enter through an `approvedMutation` envelope. Core MUST reject a mutation when its contract version is unsupported, approval is absent/expired, the actor is unauthorized, the target revision conflicts, content integrity fails or the same idempotency key has already been accepted for a different payload.

The allowed v1 operations are deliberately small:

| Operation | Effect |
| --- | --- |
| `record.create` | Creates revision 1 of a record. |
| `record.revise` | Creates the next immutable revision, checked against `baseRevision`. |
| `record.archive` | Creates a revision with state `archived`. |
| `record.restore` | Creates a revision with state `active`. |
| `record.trash` | Creates a revision with state `trashed`. |
| `asset.attach` | Stores a neutral asset and creates a new revision referencing it. |

The envelope MUST contain `mutationId`, `requestedAt`, `requestedBy`, a client idempotency key, approval evidence, operation and provenance. It MUST NOT contain domain action names such as `log_health_workout`, `calculate_calorie_deficit`, `add_business_task`, `get_today_plan` or `apply_health_update`.

`record.create` contains a `recordDraft`, so the client cannot manufacture a record ID. `record.revise` MUST carry the same `recordId` in its operation and replacement record. The replacement record MUST use `baseRevision + 1`, preserve immutable creation fields, and retain prior content/asset provenance where applicable. The JSON Schema expresses the independently verifiable shape; the implementation and future contract tests enforce these cross-field invariants.

An approval has `kind` (`user`, `migration` or `recovery`), an approving actor, timestamp and an `evidenceRef`. For user actions, `evidenceRef` is a durable reference to the explicit user authorization captured by the calling application. Migration and recovery approvals require their own explicit authorized evidence; they are not a bypass.

## Audit and change feed

For every accepted mutation, Core MUST append one audit event before reporting success. Events have:

- a monotonic `sequence` within a Vault history;
- event and mutation IDs;
- action, actor, resource ID and resulting revision;
- optional hash-chain fields for integrity verification;
- provenance where the event was produced by an import, migration, recovery or processor.

The change feed returns ordered events and an opaque `nextCursor`:

```json
{
  "contractVersion": "pv-core/v1",
  "events": ["audit-event objects"],
  "nextCursor": "v1:opaque-cursor",
  "hasMore": false
}
```

Clients SHOULD process events idempotently using `eventId` and MUST handle a cursor reset/error as a re-sync request. Core retains the canonical audit history; rebuildable indexes are never the source of a change feed.

## Retrieval and search

Record read APIs address `recordId` and return the authorized current revision or a requested explicit revision. Search is schema-neutral: it returns `recordId`, revision, state, privacy, optional title, score, snippet and neutral `matchedFields` (`title`, `content`, `metadata`, `provenance`, `asset`).

Core search MUST NOT inspect Health plans, workout names, project templates or any consumer-specific directory shape. Assistant may combine Core search results with its own domain indexes outside this contract.

## v1 MCP/API surface

These are the additive, target Core capabilities. Their final transport binding may be Streamable HTTP MCP and/or HTTP API, but request/response data MUST use the v1 envelopes above.

| Capability | Target MCP tool / API operation | Input / output |
| --- | --- | --- |
| Capture/create | `core.records.create` | Approved `record.create` mutation -> record plus audit event. |
| Attach asset | `core.assets.attach` | Approved `asset.attach` mutation -> asset, revised record and audit event. |
| Read | `core.records.get` | `recordId`, optional revision -> authorized record. |
| Search | `core.records.search` | Generic query/filter/pagination -> neutral search results. |
| Changes | `core.changes.list` | Opaque cursor/limit -> change feed. |
| Apply mutation | `core.mutations.append` | Approved generic mutation -> resulting record/asset and audit event. |
| Validate/export/rebuild | Reserved Core capabilities | Must be defined with fixtures before exposure; they are not yet implemented by this contract freeze. |

All successful and error responses MUST identify the supported `contractVersion`. Errors use the neutral codes in the schema (`invalid_request`, `unauthenticated`, `unauthorized`, `not_found`, `conflict`, `approval_required`, `integrity_failed`, `unsupported_version`, `internal_error`).

## Compatibility mapping

No existing tool changes in this step. The mapping defines the migration target and required observation order.

| Current tool | v1 target | Target owner | Compatibility rule |
| --- | --- | --- | --- |
| `capture_note` | `core.records.create` for raw storage; separate Assistant review capability | Split: Core + Assistant | Keep legacy response shape until capture creation and Assistant review are independently verified. |
| `capture_asset` | `core.assets.attach` | Core | Keep existing tool until asset IDs, digest validation, audit and record checks are exercised by fixture tests. |
| `search_vault` | `core.records.search` | Core for neutral records; Assistant for domain search | Keep current behavior until consumer-specific Health/project search is served by Assistant. |
| `apply_capture_action` | `core.mutations.append` after Assistant creates approved generic mutation | Compatibility adapter | Remove `DASHBOARD_BASE_URL` only after callers use the v1 mutation contract and rollback has been observed. |
| `get_today_plan` | Assistant-owned endpoint/tool | Assistant | Never add a Core equivalent. Preserve the public connector during the caller switch. |
| `get_capture_review` | Assistant-owned review endpoint/tool | Assistant | Core may retain evidence/provenance storage, but not review interpretation or proposals. |

The mobile ChatGPT connector URL remains unchanged during the migration. Compatibility adapters may translate legacy payloads, but they MUST emit source/provenance references and MUST NOT silently apply a domain mutation.

## Implementation invariants for the next step

1. A raw capture receives a generated `recordId`, never a filename-derived identity.
2. A repeated submission with the same idempotency key returns the original accepted result; a different payload with that key returns `conflict`.
3. A write never overwrites a prior canonical record or asset revision.
4. Every accepted mutation yields one audit event and advances the change sequence exactly once.
5. Asset bytes, record content and audit event hashes are verified before acceptance where applicable.
6. The configured Vault root is enforced after path and symlink resolution.
7. Fixture tests use a temporary redacted Vault only; they never read or mutate `/Users/kirill/personal-vault`.

## Explicitly deferred

- physical Markdown/asset layout and revision file naming;
- encryption key management, backup archive format and restore workflow;
- cross-device writer/conflict policy;
- retention/purge policy beyond recoverable trash;
- full OAuth 2.1 authorization-server contract;
- vector index schema and ranking algorithm;
- Assistant’s domain review, recommendation and approval UI contracts.

These deferrals do not permit an implementation to introduce domain logic into Core. They will be specified by a later approved contract or acceptance plan.
