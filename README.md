# Personal Vault

Personal Vault is the portable, user-owned data and integration product from Personal AI Systems. Its neutral storage/API layer is referred to internally as Core.

Target canonical repository after the approved GitHub rename: [`personal-ai-systems/personal-vault`](https://github.com/personal-ai-systems/personal-vault).

The authoritative product boundary and implementation roadmap are in [`AGENTS.md`](AGENTS.md). Read that file before changing the repository.

The durable development context is in [`docs/development-handoff.md`](docs/development-handoff.md). The current Gate 1 path, MCP-tool and dependency classifications are in [`docs/ownership-matrix.md`](docs/ownership-matrix.md); the proposed generic interfaces are in [`docs/core-contract-v1.md`](docs/core-contract-v1.md). Development is coordinated in the canonical Codex task: one approved roadmap step at a time, followed by verification and user review in that same task.

It owns the generic MCP server and writes only to a separately provisioned private Vault directory. The Vault directory contains the user's records, assets, indexes, imports and logs; none of those records belong in this repository.

## Boundaries

Core owns:

- raw readable Markdown captures and attached assets;
- generic provenance, append-only audit history and rebuildable indexes;
- generic MCP capture, record, asset and search tools;
- a thin Vault Browser for browsing, Markdown preview/editing, capture, search, archive, recoverable trash, export, backup status and restore;
- provider-independent authentication and transport configuration.

Personal Assistant owns Today/Planner/project presentation, domain dashboards, recommendations, agent workflows, domain schemas and processors. Health data may be stored as neutral source records in Core, but calorie calculations, workout interpretation and health goals belong to the Assistant's Health module. During the initial extraction, an explicitly configured local adapter preserves existing behavior while domain logic is moved out of Core.

The Vault Browser is intentionally storage-oriented. It makes Core usable without Personal Assistant or an AI model, but it does not interpret records as Health, Planner, Trading or other domain state.

## Release direction

- Umbrella brand: **Personal AI Systems**
- GitHub organization: [`personal-ai-systems`](https://github.com/personal-ai-systems)
- Product: **Personal Vault**
- Initial copyright holder and licensor: **Kirill Frolov**
- Licence: **FSL-1.1-ALv2** (Fair Source/source-available, with Apache 2.0 for each version after two years)
- Backup targets: encrypted, versioned **Google Drive** and **iCloud** archives with tested restore workflows

The target is a public alpha after the pre-public safety checklist in `AGENTS.md` passes. The repository remains private during the current compatibility and security audit.

## Run locally

```sh
npm install
PERSONAL_VAULT_ROOT=/absolute/path/to/personal-vault npm run mcp:vault
```

The Streamable HTTP MCP endpoint is served at `http://127.0.0.1:8787/mcp` by default.

## Security

Never commit a Vault directory, OAuth tokens, SSH credentials, backups, Health Connect exports, or logs. Public source must contain only code, documentation and redacted fixtures that have passed the pre-public safety gate.
