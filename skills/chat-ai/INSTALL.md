# Chat AI: install, verify, export

Version: 0.1.1. Requires Python 3.10+ for the optional management script.
The canonical source is `skills/chat-ai` in the existing Personal Vault code
repository. The installed folder is a deployment copy, not another repository.
This optional client-side integration does not change Vault storage or its API.
No hosted agent ID is created.

## Codex installation

From this folder, run:

```sh
python3 scripts/manage.py install --codex-home "$HOME/.codex" --vault-root /absolute/path/to/personal-vault --profile /absolute/path/to/private-operating-profile.md
python3 scripts/manage.py check --codex-home "$HOME/.codex" --vault-root /absolute/path/to/personal-vault --profile /absolute/path/to/private-operating-profile.md
```

The installer copies only explicitly listed package files into
`<codex-home>/skills/chat-ai`. It adds a delimited routing block to the existing
global and Vault `AGENTS.md`, preserving everything outside that block. Changed
files are backed up under `<codex-home>/backups/chat-ai/`. Existing unrecognized
skill files or local edits stop installation; inspect them before using
`--replace` to explicitly replace managed files with backed-up source versions.
No unrelated files are removed, no credentials or config.toml are changed.
The optional `--profile` is a readable private Markdown file containing the
user's browser/backup preferences and conversation-specific context windows.
Its path is referenced in local entrypoints; its contents are never bundled.
An active AGENTS.override.md stops installation rather than claiming activation
of instructions which the host will not discover.

The global routing block applies this protocol to user turns, with the Vault
block covering the workspace entrypoint. The model should read the full skill
at session start, after compaction or a revision change, then apply it on every
turn. It need not reread the same text on every internal tool/model step.
Explicit invocation remains `$chat-ai`.

For an already-running chat, read the installed skill in that chat; saving files
does not retroactively inject them into every running conversation. Start a new
chat to verify discovery and the persistent routing block independently.

`check` verifies bytes, manifests and routing blocks. It cannot verify whether
a running model loaded or followed them. Use the acceptance cases for that.
This is instruction-based routing, NOT an enforced per-inference runtime hook.
Codex builds the AGENTS instruction chain at the start of a run. The instruction
to reapply it on every turn is not automatic physical removal of old context.
Official mechanisms: https://learn.chatgpt.com/docs/agent-configuration/agents-md
and https://learn.chatgpt.com/docs/build-skills .

## Another provider or interface

Export the provider-neutral Markdown plus its resources. Install it using the
target host's skill mechanism, or place the following instruction in that host's
persistent agent entrypoint and give it authorized access to the skill files:

> Apply the Chat AI operating agreement to each user turn. Read
> `<skill-root>/SKILL.md` at session start, after context compaction and after a
> revision change. Use the configured Personal Vault as external memory, scoped
> to the current request. Do not claim tool access, background work or approval
> that has not been established.

Replace `<skill-root>` with a real path visible to that host. Configure Vault,
Drive and browser tools separately. Do not send credentials or personal files
in the skill archive. An uploaded ZIP alone proves neither activation nor tool
access. No other provider is claimed installed by this package.

## Export and Git

```sh
python3 scripts/manage.py package --output /absolute/path/to/chat-ai-0.1.1.zip
python3 -m unittest discover -s tests -v
git -C ../.. status --short
git -C ../.. add -- skills/chat-ai docs/chat-ai.md
git diff --cached --stat
git commit -m "Add portable Chat AI operating protocol"
```

The package contains only an allowlist of skill/source/test files and a SHA-256
manifest. It excludes `.git`, local state, logs, installed-file backups, account
IDs and personal Vault notes. Unknown files are not swept into an archive.
Review the archive before sharing. Adding/removing a package file requires
updating the allowlist in `scripts/manage.py`.

Use the existing repository remote. Do not initialize another repository or
change repository visibility. Review the exact staged files and preserve any
unrelated edits before committing. Push only when authorized. Follow the parent
repository license. Share the ZIP without changing cloud permissions, or grant
access to a named recipient only when authorized.

## Rollback

The installer prints backup paths for modified files. Restore the appropriate
backup only after checking for subsequent edits; do not overwrite newer user
changes. To stop routing without deleting content, remove just the block between
`<!-- chat-ai:begin -->` and `<!-- chat-ai:end -->` in the affected AGENTS.md files.
Removing only the installed skill folder leaves broken routing, so update the
entrypoints first. Removing routing does not end an already-running task.
