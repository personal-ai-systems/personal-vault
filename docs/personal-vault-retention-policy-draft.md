# Personal Vault Retention and Permanent Purge Policy (Draft)

Status: draft for review — no runtime changes yet.

This document proposes how Personal Vault should handle retention and
permanent deletion. It complements `docs/personal-vault-sync-policy-draft.md`
and the v1 contract, which today only offers reversible `record.trash` and no
physical delete.

## Principles

1. **Nothing is permanently deleted implicitly.** Purge is always an explicit,
   approval-backed, audited operation. No background janitor silently removes
   data.
2. **Reversibility first.** `record.trash` remains the recoverable state.
   Permanent purge is a separate step that a user (or an approved policy)
   invokes deliberately.
3. **Audit survives the data.** Purge must not destroy the ability to prove
   that data existed and was removed: a purge audit event with the record
   identity, revision, and a content fingerprint is kept after the body is
   gone. The body hash (sha256 of the text/payload) is retained; the body
   itself is not.
4. **Content-addressed assets are reference-counted.** An asset payload is
   physically deleted only when no remaining record revision references it.
   Purge of a record therefore decrements references; payload deletion is
   deferred and explicit.
5. **Export/backup are the escape hatch.** Purge is permanent for the live
   store only; previously taken backups/exports are not silently rewritten.
   Users who want durable deletion must manage backup lifecycle separately.

## Proposed operations

### `vault.records.purge` (new)

- Input: `{ recordId, baseRevision, reason?, evidenceRef? }`, wrapped in an
  approved mutation envelope like other operations (idempotency key,
  approval, provenance).
- Preconditions:
  - Record must exist and be in `trashed` state. (Active/archived records
    must be trashed first — prevents accidental purge of live data.)
  - `baseRevision` must match the current revision (same guard as
    `record.archive`/`record.trash`).
- Behavior:
  1. Append a `record.purged` audit event containing `recordId`,
     `revision`, and the record's content hash (not the text), plus
     `assetRefs` with asset content hashes.
  2. Remove the record file.
  3. Decrement reference counts for referenced asset payloads; queue payload
     files with zero remaining references for physical deletion.
- Result: record is no longer readable/searchable; audit proves it existed
  and was purged; idempotency replay returns the same outcome.

### `vault.assets.purge-unreferenced` (new, optional)

- Explicit operation that physically deletes asset payload files whose
  reference count is zero (no record revision references them).
- Audit event `assets.purged` with a list of `{ assetId, contentHash }`.
- This keeps payload GC manual and audited, matching Principle 1.

## Policy options for Kirill

### Option A — Manual purge only (recommended for v1)

- No automatic retention window. `record.trash` keeps records until a user
  explicitly calls `vault.records.purge`.
- Trash is unbounded by default; users can combine trash + periodic manual
  purge into their own routine.
- Pros: simplest, no data loss risk, fully audited. Cons: trash grows
  unboundedly.

### Option B — Retention window with explicit expiry

- Add a configurable retention window (e.g. `TRASH_RETENTION_DAYS=30`,
  default 0 = disabled).
- `vault.records.purge-expired` lists trashed records older than the window
  and purges them in one approved batch (one audit event per record).
- Automatic background enforcement is NOT done by the server; the operator
  (or a cron job) calls `purge-expired`. This preserves Principle 1 (no
  implicit deletion) while enabling policy-driven cleanup.
- Pros: bounded trash, deterministic. Cons: needs operator/cron; slight
  complexity.

### Option C — Permanent purge of revisions (history rewriting)

- Purge individual old revisions of a record while keeping the latest.
- Conflicts with "append-only audit history" and revision guards; likely
  out of scope for v1. Not recommended.

## Interaction with existing features

- **Integrity check**: `vault.integrity.check` must skip records that were
  purged (their purge audit event is the only trace) and must not flag
  unreferenced-but-not-yet-deleted payloads as missing. A small marker
  (`purged`) in the purge audit event's resource covers this.
- **Export/backup**: purged records are absent from new exports/backups (they
  no longer exist); the purge audit event remains in the audit section.
- **Change feed**: purge appears as a normal audit event; sync peers apply it
  as a tombstone (record deleted locally, purge event replicated).
- **Idempotency**: purge uses the same idempotency-key mechanism; a retried
  purge after a crash returns the recorded outcome.

## Required runtime support (future work)

- Reference counts for asset payloads (currently content-addressed files have
  no count; recovery/restore already avoid duplicate writes, but purge needs
  a count to decide when a payload is unreferenced).
- `record.purged` and `assets.purged` audit actions in `AUDIT_ACTIONS`.
- Purge-aware integrity check.
- (Optional) `TRASH_RETENTION_DAYS` config + `vault.records.purge-expired`.

## Open questions for Kirill

1. **Option A or B?** Manual purge only, or with a configurable retention
   window + explicit `purge-expired`?
2. **Content hash retention**: keep just `sha256` of purged record content in
   the audit event, or also keep title/metadata (for identification)? Keeping
   the hash is minimal; keeping title helps humans understand what was
   deleted.
3. **Payload GC**: implement `vault.assets.purge-unreferenced` now, or defer
   until reference counts exist and are tested?
