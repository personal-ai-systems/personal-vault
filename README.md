# Personal Vault Core

Personal Vault Core is the portable, user-owned data and integration layer for the Personal Vault system.

It owns the generic MCP server and writes only to a separately provisioned private Vault directory. The Vault directory contains the user's Markdown, assets, indexes, health imports, and logs; none of those records belong in this repository.

## Boundaries

Core owns:

- raw readable Markdown captures and image assets;
- append-only indexes and capture proposals;
- generic MCP capture, search, review, and plan tools;
- provider-independent authentication and transport configuration.

Personal Assistant owns the web UI, Today/Planner/project presentation, and dashboard-specific processors. During the initial extraction, an explicitly configured local adapter lets approved capture actions reach that UI service's existing processor endpoint. This preserves current behavior while the processor contract is moved into Core.

## Run locally

```sh
npm install
PERSONAL_VAULT_ROOT=/absolute/path/to/personal-vault npm run mcp:vault
```

The Streamable HTTP MCP endpoint is served at `http://127.0.0.1:8787/mcp` by default.

## Security

Keep this repository private. Never commit a Vault directory, OAuth tokens, SSH credentials, backups, Health Connect exports, or logs.
