# Shared memory in local Codex chats

This optional client adapter connects supported local Codex sessions to one
owner-selected Vault. It is outside the neutral file engine. The same readable
sources and context index remain usable through the library, filesystem or MCP.
It does not install a model, start a paid API or change personal task statuses.

## What happens on a turn

1. On startup, resume, fork or compaction, the adapter supplies bounded recovery
   guidance and index locators. A configured repository binding can include its
   checkpoint. Unbound chats do not inherit another project's current agenda.
2. Before a user prompt, it queries the current index through the shared engine.
   Retrieved source hashes are checked. Missing or changed sources are reported;
   the original remains available for broader reading. Full-source coverage and
   correct semantic interpretation are not implied by an index match.
3. Each answer and question must begin with `Memory:` / `Память:`: which sources
   were actually read, in what form, and the relevant short-term state. No
   retrieval must be disclosed as no retrieval. A receipt records paths, hashes,
   excerpt/checkpoint modes and limitations in `indexes/codex/retrieval/`.
4. A final response without disclosure triggers at most one corrective continuation.
   Supported `request_user_input` questions are checked before execution. This
   validates presence, not the factual correctness of every statement in a header.
5. When capture is explicitly enabled, new main-chat user messages and final
   assistant responses are saved as readable Markdown in `raw/YYYY/MM/` with
   session/turn provenance. Retries reuse identities instead of creating copies.
   This starts at activation: it does not import older chats, tool traces or
   subagent conversations. Capture is not a semantic summary or a new commitment.

Ordinary source text is labelled as evidence, not trusted host instructions.
The complete injected context is bounded. A per-session receipt/review queue is
readable under `indexes/codex/`; original dialogue does not depend on that cache.

## Install once for the local client

Use Node.js 24+ and a local Codex version supporting the documented lifecycle
hooks. Start with a temporary Vault and run `npm test`. From this source checkout:

```sh
node scripts/install-codex-memory.mjs --root /absolute/path/to/vault
node scripts/install-codex-memory.mjs --root /absolute/path/to/vault --capture --apply
```

Without `--apply`, the installer only previews. Capture defaults off; pass
`--capture` or `--no-capture` explicitly to change an existing selection. Choose
another client configuration directory with `--codex-home`. Existing unrelated
hooks/settings are preserved and changed configuration bytes are backed up.
The hook uses absolute Node/script paths: keep this installation available, or
rerun the installer after moving it. Private configuration is never committed.

Optional `--bindings /path/to/bindings.json` selects current repository contexts:

```json
[
  {
    "cwd": "/absolute/path/to/project",
    "contexts": ["project.context"],
    "checkpoint": "structured/projects/example/current-plan.md"
  }
]
```

Bindings narrow relevance, not access. The longest matching directory wins.
Use the same Vault for different repositories; do not copy personal state into
each code repository. A prompt can require evidence outside its starting project.

Then open **Codex Settings → Hooks** (or `/hooks` in the CLI) and review/trust the
exact definitions. New or changed untrusted hooks are skipped by Codex. The
installer does not set trust hashes or bypass review. Inspect discovery/trust and
actual hook execution separately. Reconnect/resume existing sessions as needed.

Official lifecycle behavior: <https://learn.chatgpt.com/docs/hooks>.

## Keep summaries fresh

The existing context-index watcher discovers changed files without a model.
Run it through the chosen host's supported service configuration; retrieval does
not secretly refresh or reread all sources. The ordinary CLI can explicitly
refresh a selected folder with `node scripts/context-index.mjs refresh --root …`.

A separately authorized Assistant/model processes changed/unreviewed captures,
reads their originals, validates source revisions and updates authored context
annotations, a recent-month overview and the current checkpoint. Recheck hashes
before publication so another chat's edits are not overwritten. Keep decisions,
proposals and unknowns distinct. Use the existing scheduler when configured;
do not create a competing timer. A scheduled definition is not proof of a later
independent successful run. This adapter does not silently choose a model.

## Coverage and acceptance

| Surface | What must be verified |
| --- | --- |
| Local CLI | Trusted discovery, actual new-session invocation, changed-source and unavailable-root behavior. |
| Local desktop | Actual desktop hook execution, resume and compaction; CLI success alone is insufficient. |
| ChatGPT web | Separate installed MCP plugin, tool discovery and actual retrieval/writeback in a conversation. |
| Mobile/cloud/other hosts | Their supported integration and its own acceptance test; local config does not propagate account-wide. |

MCP exposes the same `vault_context_get` result and source reads. An older server
must load the new code and clients must refresh tool discovery. MCP availability
does not itself capture every chat or force the model to use it. ChatGPT web
installation is documented at
<https://developers.openai.com/api/docs/guides/custom-mcp-server>.

Acceptance uses temporary data: chat A records a decision; a fresh chat B finds
it without a “read Vault” reminder; an external edit supersedes the source; a new
query/restarted session uses the correction. Check memory disclosure, source
hashes, missing-memory reporting, interruption/retry deduplication and concurrent
edits. Test compaction and a real second host separately. Do not report all-chat
coverage from unit tests, configuration or a successful tool listing.
