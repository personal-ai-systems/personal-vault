# Assistant MCP cutover and rollback

## What is running

- Public Personal Assistant MCP: `127.0.0.1:8787`, exposed through the existing public tunnel.
- Private Personal Vault MCP: `127.0.0.1:8788`, loopback-only and never exposed through that tunnel.
- The Assistant accesses records only through `PERSONAL_VAULT_MCP_URL=http://127.0.0.1:8788/mcp`.

## Healthy state

Both commands must return JSON with `status: "ok"`:

```sh
curl --fail http://127.0.0.1:8788/status
curl --fail http://127.0.0.1:8787/healthz
```

The Assistant health response must report `vaultApi: "enabled"`. The Vault response must report `bind: "127.0.0.1"`.

## Safe rollback

Rollback changes only the Assistant runtime. It never deletes the new Vault records and never deletes legacy files.

1. Stop the Assistant LaunchAgent.
2. Restore only `mcp/personal-assistant-server.mjs` from the pre-cutover Git revision or tag.
3. Reload the known Assistant LaunchAgent.
4. Check `http://127.0.0.1:8787/healthz`.

The Vault companion on `8788` may remain running; it is isolated from the public tunnel. Before attempting a rollback, preserve the current Assistant worktree and use an explicit Git revision rather than resetting unrelated dashboard changes.

## Data migration safety

`npm run migrate:legacy-vault` is dry-run by default. `npm run migrate:legacy-vault -- --apply` creates generic Vault records with migration provenance and stable idempotency keys. Re-running it does not duplicate imported files. It never removes or alters `raw/`, `structured/`, indexes or legacy assets.

Historical binary assets remain at their original locations. New Assistant attachments are stored through `vault.assets.attach`.
