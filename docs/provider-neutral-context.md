# Provider-neutral context delivery

The Vault remains a readable filesystem with neutral file operations. It does not
choose models, interpret plans, run a background assistant or manage provider
accounts. The Assistant/host owns those decisions. No second server is required.

## One owner-selected entrypoint

Set `MCP_CONTEXT_FILE` to a Vault-relative Markdown path in the service environment.
There is no default: installing the generic Vault does not implicitly load private
assistant instructions. The owner explicitly selects trusted configuration, not
an imported note. Keep provider names, keys and personal data out of shared code.

For an existing owner-managed root entrypoint, use `MCP_CONTEXT_FILE=AGENTS.md`.
No new skill or duplicate protocol is necessary. Referenced paths should be
Vault-relative rather than tied to a particular client's installation folder.
The local host can read that same file without installing or starting MCP.

```text
Owner-managed Markdown in Vault
   | direct filesystem read OR authenticated MCP
   v
Client/Assistant host loads context and relevant evidence
   v
Selected model provider
```

On authenticated MCP initialization, the server includes the file text and its
SHA-256 in `InitializeResult.instructions`. A client can discover/read
`vault://context` to obtain the latest bytes and hash. A tools-only client can use
`vault_files_read` on the configured path. Changes are visible on resource reread
or reconnect without a service restart. Connected clients must explicitly refresh;
this does not push an update into an already-running model context.

The wire protocol is MCP JSON-RPC over Streamable HTTP, not protobuf or an OpenAI
API. The configured file stays readable without the server or any provider. The
same authentication gates private startup text and resource reads, including the
legacy in-band mode. Missing, oversized, symlink or escaping files are rejected;
the ordinary file service stays available with an honest missing-context notice.
The maximum startup document size is 32 KiB. Other records are retrieved as needed.

## What the client must implement

Every supported client needs a one-time connection to this endpoint (and the
appropriate existing authorization), or an authorized filesystem path. Its host
must insert the received guidance into its model context and reapply it after
context loss. Models do not discover a user's filesystem or MCP service by name.
MCP's `instructions` field is optional guidance to the host, not enforcement:
https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts

A Codex AGENTS.md entry is one adapter. Another provider's host needs its own
adapter/configuration, not a new copy of the user's authoritative memory. A client
that ignores server instructions can still read the file, but that behavior must
be configured and verified. A cloud client cannot reach the Mac's localhost just
because it has this Markdown; use an already authorized reachable endpoint.

## Management boundary

The operating agreement is edited in the owner-selected Markdown. Files remain
inspectable through the existing Vault browser/editor. This is a configuration
surface, NOT a model-routing dashboard. Provider selection, job state, approval
enforcement, retries, budgets and 24/7 scheduling belong to the Assistant runtime.
No such management console or autonomous runtime is installed by this change.

## Verification

Run `npm run test:context` and `npm test`. The context fixture uses temporary Vault
files and both a neutral MCP SDK client and raw JSON-RPC. It covers parity,
revision refresh, authentication, unavailable files and path/size boundaries.
These are transport tests, not evidence that multiple real models obey the text.

Acceptance for a new provider requires a real host/model invocation: load the
context, report the observed revision, perform a bounded task, and resume it after
a host/model switch without losing approvals or task state. Do not claim that
merely listing a provider, copying a file or passing the fixture proves this.
