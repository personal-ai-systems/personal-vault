# Chat AI client integration

[`skills/chat-ai/SKILL.md`](../skills/chat-ai/SKILL.md) is an optional, portable
operating protocol for an AI client using a Personal Vault. It keeps three roles
separate: the AI performs reasoning/actions, the Vault stores readable evidence,
and skills describe workflows. It adds no server endpoints or domain logic.

## Read paths

- On a machine with authorized filesystem access, read/search the Vault folder
  directly. This works independently of MCP availability.
- A connected MCP client can call `vault_files_list`, `vault_files_search` and
  `vault_files_read` against the same files. See [API overview](personal-vault-api.md).
- The default `127.0.0.1` endpoint is local to its host. A remote/cloud client needs
  a deliberately configured, authenticated connection; do not expose the service
  or copy private files to a server just because a skill is installed there.

## Deployment

Use [the installer](../skills/chat-ai/INSTALL.md). Installation copies the skill
to the chosen client and adds managed entrypoint instructions with backups.
Keep the user's settings, context windows, credentials and task state outside
this repository. The installer detects local edits and masking override files.

The protocol applies per user turn, but host discovery occurs per run. Existing
sessions need to read the new instructions; a new session verifies discovery.
No scheduler, billing limit, model router or hard context filter is installed.
Do not describe file installation as a complete autonomous assistant deployment.

## Verification

```sh
python3 -m unittest discover -s skills/chat-ai/tests -v
npm test
npm run scan:secrets
```

Unit tests use temporary directories only. Run behavioral acceptance checks in
a synthetic workspace, not against real personal task mutations. A passing test
for installation is not proof of every future model response.
