# Personal Vault

Personal Vault is a local-first engine for storing user-owned records as readable Markdown with attached assets and provenance. It exposes the Vault through a Streamable HTTP MCP server so applications and AI clients can capture, retrieve and search records without owning the underlying data.

> [!WARNING]
> Personal Vault is pre-alpha software. There is no stable release, migration guarantee, production security claim or supported backup/restore workflow yet. Do not point development or test runs at a live Vault.

## Project status

This repository currently contains:

- a runnable Node.js MCP server;
- raw Markdown capture and image attachment support;
- Vault search and a health endpoint;
- optional Google identity allow-listing for MCP requests;
- a proposed versioned record, asset, provenance, audit and mutation contract;
- temporary compatibility adapters for Personal Assistant workflows.

The proposed v1 contract is not yet implemented by the running server. Contract tests, CLI commands, the Vault Browser, encrypted Google Drive/iCloud backup, restore and multi-device support are roadmap work.

Package metadata is currently `0.1.0` while the MCP server reports `0.1.1`. This known mismatch must be resolved before the first tagged release. No GitHub release has been published.

## Releases

There are no tagged releases yet, and `main` should be treated as unstable development code. Published versions and release notes will appear on the [GitHub Releases page](https://github.com/personal-ai-systems/personal-vault/releases) after the alpha release gate passes.

## Architecture

Personal Vault owns storage and generic data operations. It deliberately does not interpret the meaning of a record.

| Personal Vault | Consumer applications such as Personal Assistant |
| --- | --- |
| Records, Markdown, assets and stable IDs | Health, Today, Planner and project schemas |
| Provenance, revisions and audit history | Recommendations and domain interpretation |
| Generic capture, retrieval and search | Model routing and agent workflows |
| Validation, export, backup and restore infrastructure | Approval and domain-specific user experiences |

For example, Personal Vault may store a meal photo or Fitbit export as a neutral source record. A Health module owns calorie estimates, goals and medical interpretation.

The current MCP server still contains domain-specific compatibility logic. That logic is tracked migration debt and is not part of the target public interface. See [the ownership matrix](docs/ownership-matrix.md) for the current split.

## Requirements

- Node.js 24 or later
- npm
- a separate directory to use as the Vault data root

The repository and the Vault data directory must remain separate. Never place private Vault contents, credentials, imports, backups or logs inside this checkout.

## Quick start

Install dependencies:

```sh
git clone https://github.com/personal-ai-systems/personal-vault.git
cd personal-vault
npm ci
```

Start the server against a disposable development Vault with authentication disabled:

```sh
mkdir -p /tmp/personal-vault-dev
PERSONAL_VAULT_ROOT=/tmp/personal-vault-dev \
MCP_GOOGLE_AUTH=false \
npm run mcp:vault
```

The server listens on `http://127.0.0.1:8787` by default:

```sh
curl http://127.0.0.1:8787/healthz
```

The MCP endpoint is `http://127.0.0.1:8787/mcp`.

## Configuration

Configuration is supplied through environment variables. See [.env.example](.env.example) for a starting point.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PERSONAL_VAULT_ROOT` | `~/personal-vault` | Absolute path to the separately provisioned Vault directory. Set this explicitly in development. |
| `MCP_PORT` | `8787` | Local HTTP port. `PORT` is also accepted. |
| `MCP_PUBLIC_BASE_URL` | inferred from request | Public base URL used in OAuth metadata. |
| `MCP_GOOGLE_AUTH` | `false` | Require Google access-token validation when set to `true`. |
| `GOOGLE_ALLOWED_EMAILS` | empty | Comma-separated email allow-list. |
| `GOOGLE_ALLOWED_DOMAINS` | empty | Comma-separated Google Workspace domain allow-list. |
| `MAX_CAPTURE_ATTACHMENT_BYTES` | `8388608` | Maximum decoded size of one image attachment. |

The following variables exist only for transitional Personal Assistant compatibility and should not be used to build new Personal Vault features:

- `DASHBOARD_BASE_URL`
- `CAPTURE_REVIEW_PROVIDER`
- `CAPTURE_REVIEW_TIMEOUT_MS`
- `CAPTURE_REVIEW_CODEX_MODEL`
- `CODEX_BIN`

## Current MCP surface

| Tool | Current behavior | Target ownership |
| --- | --- | --- |
| `capture_note` | Saves raw Markdown, then produces compatibility proposals and questions. | Split: generic capture stays in Personal Vault; interpretation moves to Personal Assistant. |
| `capture_asset` | Adds image bytes to an existing Markdown capture. | Personal Vault. |
| `search_vault` | Searches Markdown plus some Assistant-generated structured files. | Split: generic search stays; domain search moves out. |
| `apply_capture_action` | Sends an approved proposal to Personal Assistant. | Temporary compatibility adapter. |
| `get_capture_review` | Returns Assistant-style review artifacts. | Personal Assistant. |
| `get_today_plan` | Reads Today and Health projections. | Personal Assistant. |

Do not treat these legacy tool names or response shapes as the v1 public contract.

## Repository layout

```text
.
├── mcp/                     # Current Streamable HTTP MCP implementation
├── contracts/v1/            # Machine-readable proposed v1 contract
├── docs/                    # Architecture, ownership and migration documentation
├── AGENTS.md                # Authoritative product boundary and delivery roadmap
├── package.json             # Runtime requirements and npm scripts
└── LICENSE                  # FSL-1.1-ALv2 terms
```

## Documentation

- [Project boundary and roadmap](AGENTS.md)
- [Proposed v1 data contract](docs/core-contract-v1.md)
- [Machine-readable v1 schema](contracts/v1/core-contract-v1.schema.json)
- [Current ownership and dependency matrix](docs/ownership-matrix.md)
- [Development handoff and verified state](docs/development-handoff.md)
- [Fluid capture design](docs/personal-vault-fluid-capture.md)

## Development

Start the MCP server:

```sh
npm run mcp:vault
```

Run the checks currently available in the repository:

```sh
node --check mcp/personal-vault-server.mjs
npm ls --depth=0
```

There is no automated test suite or CI pipeline yet. Temporary-fixture contract tests are the next implementation milestone. Tests must use a disposable Vault and must never read or mutate a user's live data directory.

Before changing architecture or public interfaces, read [AGENTS.md](AGENTS.md). Keep changes narrow, preserve raw source material and provenance, and do not remove compatibility behavior until its replacement and rollback path have been verified.

## Security

Do not commit:

- Vault records or attached assets;
- OAuth tokens, private keys or credentials;
- backups, imports or exported health data;
- runtime logs or generated review artifacts.

Security reporting guidance and the complete pre-public checklist will be added before the repository becomes public. Until then, this project must not be represented as production-ready.

## Contributing and support

Before proposing architecture or interface changes, read [AGENTS.md](AGENTS.md) and open a [GitHub issue](https://github.com/personal-ai-systems/personal-vault/issues) for discussion. Bug reports must use redacted fixtures and must not contain private Vault data or credentials.

A complete contribution guide, code of conduct and security policy will be added before public alpha. The initial maintainer is Kirill Frolov under the Personal AI Systems project brand.

## Licence

Personal Vault is licensed under [FSL-1.1-ALv2](LICENSE). It is Fair Source/source-available software, not OSI Open Source during the first two years of each released version. Each version becomes available under Apache License 2.0 on the second anniversary of its publication.

Copyright 2026 Kirill Frolov.
