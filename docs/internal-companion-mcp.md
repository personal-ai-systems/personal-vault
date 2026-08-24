# Internal Personal Vault MCP Companion

The initial Personal Assistant integration runs Personal Vault as a separate,
private companion process on loopback. The public Personal Assistant MCP keeps
its existing endpoint and tool names; Personal Vault is not exposed through the
public tunnel.

## Local companion configuration

Use a Vault root that is separate from the source repository and set the bind
address explicitly:

```sh
PERSONAL_VAULT_ROOT=/path/to/private-vault \
MCP_HOST=127.0.0.1 \
MCP_PORT=8788 \
MCP_GOOGLE_AUTH=false \
npm run mcp:vault
```

The companion endpoint is:

```text
http://127.0.0.1:8788/mcp
```

Port `8788` is the integration default because the existing public Personal
Assistant MCP currently owns port `8787`. `MCP_HOST=127.0.0.1` keeps the Vault
process loopback-only. Do not place this endpoint behind the public Assistant
tunnel.

Google authentication behavior is unchanged. `MCP_GOOGLE_AUTH=true` still
requires Google access-token validation; the disabled value above is only for
loopback local development and fixture tests.

## Fixture smoke test

Run:

```sh
npm run test:mcp-smoke
```

The smoke test:

1. creates a redacted temporary Vault root under the system temporary
   directory;
2. reserves an available loopback port (so it does not collide with running
   services);
3. starts its own Personal Vault MCP child process bound to `127.0.0.1`;
4. performs real MCP initialize, tool discovery, `vault.records.create`, and
   `vault.records.get` calls through the SDK Streamable HTTP client;
5. asserts that every discovered tool is in the `vault.*` namespace;
6. closes the MCP client, stops the child process, and deletes the fixture root
   in a `finally` cleanup path.

It never points at `/Users/kirill/personal-vault`, does not edit or load a
LaunchAgent, and does not use a public tunnel.
