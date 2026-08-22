# Personal Vault Durable Authorization Policy (Draft)

Status: draft for review — no runtime changes yet.

This document proposes durable, provider-independent authorization for
Personal Vault. The current server supports either unauthenticated local use
(`MCP_GOOGLE_AUTH=false`) or online Google userinfo validation. That is useful
for prototyping but not sufficient for offline operation, peer sync, or a
self-hosted user-owned product.

## Goals

1. Work offline and without Google or another identity provider.
2. Keep secrets out of the repository, logs, audit events, exports and MCP
   responses.
3. Support key rotation and revocation without rewriting Vault records.
4. Allow different permissions for read, write, backup and administrative
   operations.
5. Preserve Google OAuth as an optional authentication adapter rather than a
   hard dependency.

## Proposed model

### Authentication modes

Introduce one explicit configuration variable:

```text
MCP_AUTH_MODE=disabled | local-token | google
```

- `disabled`: intended only for a loopback-bound development server.
- `local-token`: recommended durable/offline mode for a personal deployment.
- `google`: existing behavior, retained as an optional adapter.

The server must fail closed on an unknown value. A non-loopback bind with
`disabled` mode should fail startup unless an explicit development override is
provided.

### Local token format

Use opaque random bearer tokens rather than signed JWTs:

- Generate at least 32 random bytes (256 bits), encoded as base64url.
- Store only a salted password hash of each token, never the token itself.
- Recommended KDF: scrypt with the same baseline parameters already used by
  encrypted backups, but with an independent random salt per token.
- The clear token is shown exactly once at creation time and is then the
  user's responsibility (password manager / OS keychain).

Opaque tokens avoid JWT key-management complexity and permit immediate
revocation. They are sufficient because the Vault server itself is the token
issuer and verifier.

### Credential store

Store credentials outside canonical records:

```text
<VAULT_ROOT>/.personal-vault/auth/credentials.json
```

Each entry contains only:

```json
{
  "credentialId": "pvc_...",
  "label": "Kirill MacBook",
  "actor": { "kind": "user", "id": "kirill" },
  "scopes": ["vault.read", "vault.write", "vault.backup"],
  "salt": "base64...",
  "tokenHash": "base64...",
  "createdAt": "...",
  "expiresAt": null,
  "revokedAt": null
}
```

The file must be mode `0600` where the platform supports POSIX permissions.
Credentials are excluded from exports/backups by default; a separate encrypted
credential-backup flow can be designed later.

### Scopes

Recommended v1 scope set:

| Scope | Capabilities |
| --- | --- |
| `vault.read` | records.get/search, changes.list, integrity.check |
| `vault.write` | records.create, mutations.append, assets.attach |
| `vault.export` | export.create/verify |
| `vault.backup` | backup.create/restore |
| `vault.admin` | indexes.rebuild, credential create/revoke/rotate |

Scopes are checked by tool registration wrappers, not by application-specific
record meaning. This preserves the neutral Core boundary.

### Actor binding

A verified credential resolves to a stable actor. Mutation envelopes must use
an actor consistent with the authenticated credential; clients may not claim
another `requestedBy`. For service credentials, `actor.kind=service`; for
people, `actor.kind=user`.

This makes audit attribution durable and prevents a valid token from forging
another actor's identity.

## Proposed administrative operations

Administrative operations are intentionally not exposed until bootstrapping is
specified. Candidate CLI-only commands:

- `personal-vault auth init` — create the first admin credential when no
  credential store exists.
- `personal-vault auth create --label ... --scopes ...` — create a credential
  and print its clear token once.
- `personal-vault auth revoke <credentialId>` — set `revokedAt`.
- `personal-vault auth rotate <credentialId>` — revoke the old token and issue
  a replacement.
- `personal-vault auth list` — metadata only; never show token hashes or salts.

The first admin credential must be created locally with filesystem access; it
must not be bootstrap-able over the network.

## HTTP/MCP behavior

Clients send:

```http
Authorization: Bearer <opaque-token>
```

On failure, return MCP auth metadata and a generic reason (`invalid or expired
credential`) without revealing whether a credential ID exists. Compare hashes
with a constant-time primitive.

`/.well-known/oauth-protected-resource` should reflect the selected auth mode:
Google metadata in `google` mode; local issuer/resource metadata in
`local-token` mode; absent or clearly disabled in development mode.

## Migration from current behavior

1. Add `MCP_AUTH_MODE`, keeping backward compatibility temporarily:
   - if unset and `MCP_GOOGLE_AUTH=true`, choose `google`;
   - if unset otherwise, choose `disabled` only when bound to loopback.
2. Implement local credential verification and scope checks with temporary
   fixture tests.
3. Add the local CLI bootstrap flow.
4. Deprecate `MCP_GOOGLE_AUTH` after configuration migration documentation is
   available; Google remains selectable through `MCP_AUTH_MODE=google`.

## Security requirements and tests

- Token is never logged or returned after creation.
- Credential store permission test (`0600` on POSIX).
- Correct token accepted; wrong, expired and revoked tokens rejected.
- Scope enforcement per MCP operation.
- Actor mismatch rejected on mutations.
- Rotation immediately invalidates the old token.
- Auth tests use a temporary Vault root; never the live Vault.
- Working tree and full-history secret scans remain mandatory in CI.

## Options for Kirill

### Option A — Opaque local tokens (recommended)

Simple, offline, immediately revocable, minimal cryptographic surface. Requires
server-side credential storage.

### Option B — Locally signed JWTs

Better for distributed verification, but needs signing-key rotation, token
expiry and revocation lists. Unnecessary while one Vault server verifies all
requests.

### Option C — Keep Google-only auth

Lowest implementation effort but contradicts offline/provider-independent
operation and makes peer sync depend on Google availability.

## Open questions for Kirill

1. Choose **Option A (recommended)**, B or C.
2. Should the first implementation support scopes immediately, or start with a
   single admin-equivalent token? Recommendation: scopes immediately; the
   scope table is small and avoids a breaking auth change later.
3. Should credentials be included in encrypted backups? Recommendation: no in
   v1; restore data first, then bootstrap fresh credentials locally.
