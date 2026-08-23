# Personal Vault

Personal Vault is a local-first storage engine for user-owned records, readable Markdown and provenance. Its v1 contract also specifies binary asset handling. It exposes generic record operations through a Streamable HTTP MCP server.

> [!WARNING]
> This is pre-alpha software. There is no stable release, migration guarantee, production security claim, supported backup workflow or public compatibility commitment yet. Do not use a live Vault for development or tests.

## What it provides

- generic record creation, retrieval and search;
- approved, auditable record mutations;
- content-addressed binary asset attachment with readable metadata;
- portable verified export of records, assets and audit history;
- encrypted backup and non-destructive restore;
- readable record representation and provenance;
- authenticated Streamable HTTP MCP transport;
- a versioned public contract: `personal-vault/v1` and `vault.*`.

Synchronization is specified or planned work; it is not implemented by the current server.

Personal Vault stores information but does not interpret it. Application-specific meaning, recommendations, planning and model behavior are outside this repository.

## Status and releases

The current package version is `0.1.0`. No GitHub release has been published; `main` is unstable development code. Future versions and release notes will appear on the [GitHub Releases page](https://github.com/personal-ai-systems/personal-vault/releases).

## Requirements

- Node.js 24 or later
- npm
- a separate directory for Vault data

Keep the repository and Vault data directory separate. Never commit records, assets, credentials, backups, imports or logs.

## Quick start

```sh
git clone https://github.com/personal-ai-systems/personal-vault.git
cd personal-vault
npm ci

mkdir -p /tmp/personal-vault-dev
PERSONAL_VAULT_ROOT=/tmp/personal-vault-dev \
MCP_GOOGLE_AUTH=false \
npm run mcp:vault
```

The local MCP endpoint is `http://127.0.0.1:8787/mcp`.

Check server status in a second terminal:

```sh
curl http://127.0.0.1:8787/status
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PERSONAL_VAULT_ROOT` | `~/personal-vault` | Absolute path to Vault data. Set this explicitly in development. |
| `MCP_PORT` | `8787` | Local HTTP port. `PORT` is also accepted. |
| `MCP_PUBLIC_BASE_URL` | inferred from request | Public base URL used in OAuth metadata. |
| `MCP_GOOGLE_AUTH` | `false` | Require Google access-token validation when `true`. |
| `GOOGLE_ALLOWED_EMAILS` | empty | Comma-separated email allow-list. |
| `GOOGLE_ALLOWED_DOMAINS` | empty | Comma-separated domain allow-list. |

## MCP surface

| Operation | Purpose |
| --- | --- |
| `vault.records.create` | Create a generic record from an approved mutation. |
| `vault.assets.attach` | Attach a content-addressed asset to a record. |
| `vault.records.get` | Read a record by stable ID. |
| `vault.records.search` | Search record title and content. |
| `vault.changes.list` | Read audit events after a cursor. |
| `vault.export.create` | Create a portable verified export bundle. |
| `vault.export.verify` | Verify a stored export file manifest and payloads. |
| `vault.backup.create` | Create a passphrase-encrypted backup. |
| `vault.backup.restore` | Non-destructively restore an encrypted backup. |
| `vault.integrity.check` | Verify store integrity without modifying it. |
| `vault.mutations.append` | Apply an approved generic mutation. |

## Repository layout

```text
.
├── mcp/                     # Streamable HTTP MCP server
├── contracts/v1/            # Machine-readable public contract
├── docs/                    # Product and contract documentation
├── AGENTS.md                # Development and ownership rules
├── package.json             # Runtime requirements and scripts
└── LICENSE                  # FSL-1.1-ALv2 terms
```

## Documentation

- [Development guide](AGENTS.md)
- [Personal Vault Contract v1](docs/personal-vault-contract-v1.md)
- [Machine-readable schema](contracts/v1/personal-vault.schema.json)
- [Synchronization and concurrency policy draft](docs/personal-vault-sync-policy-draft.md)
- [Retention and permanent purge policy draft](docs/personal-vault-retention-policy-draft.md)
- [Durable authorization policy draft](docs/personal-vault-durable-auth-policy-draft.md)

## Development

```sh
node --check mcp/personal-vault-server.mjs
npm ls --depth=0
npm test
npm run scan:secrets        # scan working tree for potential secrets
npm run scan:secrets:history # scan full git history for potential secrets
```

Use temporary redacted fixtures for every test. Public interfaces must remain generic, versioned and independently testable.

## Security

Do not commit Vault data, assets, secrets, credentials, backups, imports or runtime logs. A security policy and public contribution guide will be added before public alpha.

## Licence

Personal Vault is licensed under [FSL-1.1-ALv2](LICENSE). It is Fair Source/source-available software; each released version becomes available under Apache License 2.0 on its second anniversary.

Copyright 2026 Kirill Frolov.
