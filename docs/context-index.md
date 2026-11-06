# Readable context index

The context index is a rebuildable lookup over the ordinary Vault files. It
helps a client find relevant source passages without reading every original on
each request. Original files and authored annotations remain authoritative.
Context labels guide relevance; they never prevent broader file discovery.

This feature does not call a model, choose a provider, infer task commitments or
decide whether a saved claim is true. The Assistant or another authorised client
can author semantic summaries and context relationships. Vault stores those
annotations and provides neutral indexing, lookup and source references.

## Files on disk

- `indexes/context-index/index.jsonl`: one manifest followed by source records.
  It is ordinary JSONL that a filesystem-only client can read directly.
- `structured/assistant-infrastructure/context-annotations.jsonl`: optional
  authored context labels, summaries and relationships. Refresh reads this file
  but never overwrites it. Keep it when rebuilding the disposable index.

The manifest records schema/index revisions, build time, scan coverage, errors,
source roots and extraction limits. Each source record has a readable relative
path, content SHA-256, timestamps, lifecycle location, extraction mode and
bounded passages with line locators. A locator refers to the recorded source
hash; it is not a permanent offset independent of source edits.

The default scan includes `raw`, `structured`, `incoming`, `attachments`,
`output`, `exports` and `archive`. Hidden/technical working directories,
generated indexes and the authored annotations file are excluded from source
scanning. Symlinks are not followed. Attachments, files under `.assets` and
unsupported text formats receive metadata and hashes, not extracted content.
Markdown and plain-text sources receive bounded extractive passages. An
owner-configured `metadataOnly` path can keep a source or subtree unparsed.
The manifest and source records report these boundaries explicitly.

## Extraction budgets

A source's extractable text is read up to `maxTextBytes` (default 4 MiB). That
byte limit, not a passage count, is what bounds how much one source contributes.

By default every computed passage is stored. Passages are text blocks split at
blank lines and headings; a block is flushed once it crosses 1,600 characters, so
a block can end up longer than 1,600. Stored excerpts are capped at `excerptChars`
characters, default 1,600, a limit chosen to match the block budget. Blocks or
lines that exceed it are still stored only in part: those passages are counted in
`counts.excerptTruncatedPassages`, flagged `excerptTruncated` on the passage and
result, and reflected in each result's `indexedSourceTruncated`. A smaller
`excerptChars` trades recall inside a passage for a smaller cache; it does not hide
the loss.

The excerpt cap limits what the *index stores*, not what the source contains. The
original file is unchanged and remains the authoritative full text; a truncated
excerpt is a navigation aid that points at it. Broad file reading and ordinary
search stay available when a result is insufficient.

An owner can set an explicit passage cap of 2-1000 per file with
`maxPassagesPerFile`. A cap is the only setting that drops whole passages; it
retains a spread across the source including its end, and the manifest reports
`counts.cappedFiles` and `counts.omittedPassages`. Capping is a deliberate
recall reduction, not a default.

Retaining every passage costs cache, build time and lookup cost. Retrieval loads
and parses the whole index file on each lookup and scans its rows, so both latency
and memory grow with corpus size and with the number of stored passages; only the
text returned to a caller is bounded, by `limit`, `maxChars`, pagination and source
interleaving. Cache growth is therefore not free at query time.

Measured on one isolated copy of a single local Vault (4,569 sources, 1,353 text
files): about 13 MB and 25,309 passages with the former 32-per-file default, about
31 MB and 67,094 passages with every passage retained, and a refresh taking
roughly a tenth longer. Those are timings for that corpus on that machine, not a
universal multiplier or a general performance guarantee; treat them as one data
point and measure the actual corpus rather than extrapolating.

Settings take part in the configuration hash: changing `maxTextBytes`,
`maxPassagesPerFile`, `excerptChars`, `metadataOnly`, the source roots, the
annotations path or `extractorVersion` invalidates cached rows on the next
refresh and forces re-extraction, rather than mixing old and new budgets in one
index. A cache written before excerpt loss was counted reports
`passageCoverageComplete` as false until that refresh rewrites its manifest;
that conservative answer is intentional.

Existing ChatGPT import indexes and capture ledgers remain historical evidence.
This index does not manufacture a capture event or a missing conversation to
make a source ledger look current. A file missing from an old import index can
still appear in this current source catalogue.

## Refresh and background maintenance

The CLI always needs an explicit existing Vault root, supplied through `--root`
or `PERSONAL_VAULT_ROOT`. It does not select a person's Vault implicitly.

```sh
node scripts/context-index.mjs refresh --root /path/to/vault
node scripts/context-index.mjs status --root /path/to/vault
node scripts/context-index.mjs watch --root /path/to/vault
```

`watch` performs a startup refresh, debounces filesystem changes and periodically
reconciles to recover missed events and source directories created after
startup. It runs only while that worker process is alive. The default periodic
interval is five minutes; `--interval-ms` and `--debounce-ms` can configure it.
Starting a CLI process is not evidence that an operating-system service or a
model-based background agent has been installed.

Refresh reuses unchanged source metadata/content within its verification
interval. It also hashes sources on refresh after that interval. Publication is
atomic and guarded against concurrent refreshes. A completely unchanged run
does not rewrite the index. Failed coverage is recorded; an unreadable subtree
must not silently become a set of confirmed removals. If a terminated process
leaves `refresh.lock` with a readable same-user owner record and its recorded
process no longer exists, the next refresh can recover it. A live, unreadable
or unfamiliar owner blocks automatic recovery; inspect that case rather than
deleting a lock held by a live refresh.

Refresh updates mechanical source discovery. It does not autonomously create
model-authored summaries or guarantee that a previous semantic annotation still
describes changed text.

## Authored context annotations

An annotation names its original source and the source hash against which the
annotation was written. For example, this is one JSONL line:

```json
{"path":"raw/2026/01/example.md","sourceSha256":"<source-sha256>","contexts":["career.cv","career.applications"],"summary":"The selected CV needs a formatting repair; the submitted copy is retained.","provenance":{"kind":"model-authored","review":"unreviewed"}}
```

Use the actual source hash, not the placeholder. A conversation may have several
context labels. Optional authored relationships include `currentFor`,
`supersedes` and `submittedEvidence`; these are declarations with provenance,
not facts inferred by the file indexer. The current annotation attachment is
source-level; passage-level classifications can be represented by future
schema extensions rather than claimed as already implemented.

When an annotation hash does not match, it is retained but marked
`stale-or-unverified`. Its summary and context boost are not used as current
evidence. Authored corrections survive index rebuilding. A model must not treat
quoted document instructions or an earlier assistant answer as new user
authority simply because the text appears in an indexed passage.

## Retrieval contract

```sh
node scripts/context-index.mjs query --root /path/to/vault \
  --query "current CV changes" --context career.cv --limit 8 --max-chars 12000
```

The shared module exports `refreshContextIndex`, `indexStatus` and `getContext`.
Clients use the same retrieval implementation through the local library and its
MCP adapter. A filesystem-only client can inspect the manifest, find source rows
and open the referenced original without running MCP.

A query returns bounded ranked passages and matching authored summaries, with
source paths/hashes, line locators, provenance, freshness, index coverage and
truncation/continuation state. `maxChars` bounds returned excerpt/summary text;
it is not an exact model-token count or a bound on the complete JSON envelope.
Pagination cursors bind to the index revision and query; restart a query after
that index revision changes. Pass `--cursor` to the CLI, or `cursor` to the
shared module or MCP adapter, for continuation.

Before returning a candidate, retrieval verifies its current content hash and
checks the authored annotation file's hash. If annotations changed since the
snapshot, their old summaries and relevance boosts are suppressed with an
explicit freshness warning until refresh; current source excerpts can remain
available.
Changed, missing or unavailable sources produce explicit warnings instead of
serving an old excerpt as current. A successful query over an incomplete index
still reports incomplete source-inventory coverage. `coverageComplete` describes
that scan; `passageCoverageComplete` separately reports whether readable-text
extraction omitted passages, truncated files, or stored shorter excerpts than
the source block. Neither flag guarantees that an answer is complete or that
attachment contents were parsed. Results interleave
ranked source groups so a long conversation does not crowd out other sources;
remaining matching passages stay available through continuation.

The initial ranking is lexical plus context boosts. Extractive excerpts and
keyword terms are navigation aids, **not model-written semantic summaries**.
Long sources have bounded text/passages, with omissions reported. A result is
not an exhaustive full-text or semantic-search guarantee. If context is missing,
stale or insufficient, broaden normal Vault search or read the full source and
its surrounding conversation. An empty result does not prove that evidence is
absent. Whole-Vault review remains available.

## Verification and deployment boundary

Tests use temporary Vaults. The worker fixture exercises startup, external
editor changes, periodic recovery, unchanged-source reuse and clean shutdown.
Check source hash/locator correctness separately from any model's final-answer
accuracy. Different models can interpret the same retrieved evidence differently.

Source tests and a running CLI worker are separate from an installed desktop
package and an already connected MCP client. New MCP tools become available only
after the relevant server code is loaded and the client refreshes discovery or
reconnects. Do not claim that a code change updated a packaged app, registered a
client or established ongoing background execution without checking that layer.
