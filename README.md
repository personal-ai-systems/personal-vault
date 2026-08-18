# Personal Vault Core

Personal Vault Core is the portable, user-owned data and integration layer for the Personal Vault system.

The authoritative product boundary and implementation roadmap are in [`AGENTS.md`](AGENTS.md). Read that file before changing the repository.

It owns the generic MCP server and writes only to a separately provisioned private Vault directory. The Vault directory contains the user's records, assets, indexes, imports and logs; none of those records belong in this repository.

## Boundaries

Core owns:

- raw readable Markdown captures and attached assets;
- generic provenance, append-only audit history and rebuildable indexes;
- generic MCP capture, record, asset and search tools;
- provider-independent authentication and transport configuration.

Personal Assistant owns the web UI, Today/Planner/project presentation, domain schemas and processors. Health data may be stored as neutral source records in Core, but calorie calculations, workout interpretation and health goals belong to the Assistant's Health module. During the initial extraction, an explicitly configured local adapter preserves existing behavior while domain logic is moved out of Core.

## Run locally

```sh
npm install
PERSONAL_VAULT_ROOT=/absolute/path/to/personal-vault npm run mcp:vault
```

The Streamable HTTP MCP endpoint is served at `http://127.0.0.1:8787/mcp` by default.

## Security

Keep this repository private. Never commit a Vault directory, OAuth tokens, SSH credentials, backups, Health Connect exports, or logs.
