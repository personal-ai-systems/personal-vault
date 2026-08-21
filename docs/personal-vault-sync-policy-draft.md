# Personal Vault Synchronization and Concurrency Policy (Draft)

Status: draft for review — no runtime changes yet.

This document proposes how multiple Personal Vault instances (devices,
processes, or agents) can converge on the same durable state without a central
server. It builds on the existing `personal-vault/v1` primitives: approved
mutations, idempotency keys, the append-only audit/change feed, revision
guards, and the crash-recovery journal.

## Goals

1. Every accepted mutation is applied exactly once, even with retries or
   overlapping replication.
2. All instances converge to the same record set and audit history.
3. Conflicting concurrent writes are either rejected deterministically or
   resolved with an explicit, audited strategy — never silently overwritten.
4. Assets are deduplicated by content hash and never re-transferred when a
   peer already has the payload.

## Non-goals

- Real-time collaboration or CRDT-style field merging of record bodies.
- Replacing the approval model; every mutation still carries an approved
  envelope with evidence.
- Multi-master writes to the *same* revision of the same record without
  conflict signaling.

## Model

### Source of truth: the audit log

The change feed (`vault.changes.list`) is the replication primitive. Each
event is immutable, has a stable `eventId`, and carries the mutation's
`mutationId`, the resulting revision, and the affected record. A consumer
replays events in `sequence` order. Because `eventId` is the dedup key, a
peer that already processed an event skips it idempotently.

### Mutation exchange

Peers exchange **approved mutations**, not final record states, for writes:

1. A peer constructs a `record.revise` / `record.archive` / `record.restore`
   / `record.trash` / `asset.attach` mutation with an idempotency key and
   `baseRevision` equal to the revision it has seen for the target record.
2. The receiving instance applies it through `applyMutation` (or the
   `vault.mutations.append` tool).
3. If `baseRevision` no longer matches, the mutation is **rejected as a
   conflict** and the sender must re-fetch and rebase.
4. Idempotency keys make retries safe: re-delivering the same mutation after
   a network failure returns the original result instead of double-applying.

### Conflict policy

For full-record operations (`record.revise`, lifecycle changes,
`asset.attach`):

- **Default: reject on revision mismatch.** The `baseRevision` guard is the
  contract. A stale writer receives a conflict error, re-reads the current
  record, and re-submits against the latest revision.
- **No silent last-writer-wins.** The contract principle "mutations are
  explicit, approval-backed, idempotent and audited" rules out overwriting a
  newer revision. If product-level LWW is desired later, it must be a
  deliberate `record.revise` submitted after a successful re-read, which
  remains audited and explicit.

Conflicts are therefore detected at the storage boundary, not papered over by
the sync layer.

### Asset replication

Assets are content-addressed (`sha256:<hex>` payload path). Before
transferring a payload, a peer asks whether the content hash already exists;
if so, only the `asset.attach` mutation (metadata + reference) is replicated.
This gives natural deduplication and idempotent re-attachment.

### Deletion and tombstones

There is no physical delete in v1. `record.trash` moves a record to
recoverable trash and is replicated like any other mutation. Peers therefore
converge without needing delete tombstones. Permanent purge is a separate,
future policy and must be an explicit audited operation (see Deferred work).

## Sync procedure (proposed)

Given two instances A and B:

1. B asks A for `vault.changes.list(cursor)` starting at B's last seen
   cursor; A returns ordered events, `nextCursor`, `hasMore`.
2. B walks pages until `hasMore` is false, recording `nextCursor` as its
   checkpoint.
3. For each event B has not seen (`eventId` not in B's audit set), B fetches
   the corresponding mutation (via the mutating peer's outbox or a direct
   `vault.mutations.append` replay of the recorded envelope) and applies it
   with its idempotency key.
4. B re-verifies with `vault.integrity.check` and updates its checkpoint.

Because the audit log is append-only and events carry `mutationId`, this
procedure is crash-safe: an interrupted sync resumes from the last
checkpoint without re-applying committed mutations (idempotency replay).

## Required runtime support (future work)

- A mutation outbox or a way to retrieve the original mutation envelope by
  `mutationId` (currently audit events carry `mutationId` but not the full
  envelope).
- A `vault.sync.pull(cursor)` convenience over `vault.changes.list` that
  also returns the mutation envelopes needed for replay.
- Optional: a lightweight instance identity in `actor.id` / `requestedBy`
  so peers can attribute mutations to the originating device.
- Conflict surfacing in the MCP error contract (currently plain errors with
  messages; a stable `conflict` code would help clients).

## Deferred work

- Retention and permanent purge policy (requires explicit design decision;
  see AGENTS.md release evidence: "secret and private-data scanning of the
  full history" and "retention").
- Durable authorization so a peer can authenticate without Google OAuth.
- Encryption of records at rest and backup format migration.

## Open questions for Kirill

1. Should record-level conflicts ever auto-merge (e.g., distinct metadata
   namespaces)? Recommendation: no in v1.
2. Should there be a cap on idempotency-key retention, or keep entries
   forever? Recommendation: keep forever in v1; purge belongs to retention.
3. Is a single-instance-writer assumption acceptable initially (one peer
   writes while others replicate), or is full multi-master required?
