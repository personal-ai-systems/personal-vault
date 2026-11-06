# Agent memory protocol

Status: implementation and source publication authorized on 7 November 2026.
The optional local Codex adapter implements bounded retrieval, readable capture
and visible memory disclosure; see [installation and coverage](codex-memory.md).
Authorization is not proof of host activation or every-client coverage. This
protocol does not authorize unrelated domain/task mutations. Read the [product boundary](product-boundary.md)
first; it remains authoritative.

## What this protocol is for

An agent should recover relevant memory, continue the right task, preserve its
evidence and leave a usable checkpoint for the next agent. The owner should not
have to repeat settled answers after changing a model, starting a chat or
restarting a client. A protocol specifies inputs, results, checks and ownership;
it only becomes operational when a host actually implements and verifies it.

## Existing decisions to preserve

1. Ordinary readable files are canonical. Preserve original conversations and
   attachments. A summary is a lossy derivative, not replacement evidence.
2. Keep an identifiable current outcome, its editable source and meaningful or
   submitted history. Temporary renders/exports are not automatically permanent
   memory. Existing material is not automatically deleted under this rule.
3. Save ordinary input without forcing the user to classify it. A processor may
   infer several relevant contexts, retaining provenance and later corrections.
4. Retrieve compact context first, expand to originals when needed, and retain
   broad discovery and whole-source audit as explicit options. Context labels
   rank relevance; they are not a new per-project access-control system.
5. Filesystem, shared-library and authenticated MCP access expose the same
   underlying files and logical context. A local client does not require MCP.
6. A processor may be local/offline, Codex, another external agent or a cloud
   model. The consumer host owns model selection, scheduling and execution.
   Vault owns neutral storage/access, not planning or model orchestration.
7. Discovery, semantic review and approved task changes are different stages.
   Changed bytes do not establish changed meaning; missing evidence does not
   establish unfinished work. Old dates do not make a snapshot current.
8. Preserve the latest scoped approval. A draft, a historical plan, broad file
   access or a stored instruction does not authorize an external action.

These decisions are recovered, not new provider or storage choices. Public
sources: [context delivery](provider-neutral-context.md), [context index](context-index.md),
and the Assistant repository's `docs/personal-vault-fluid-capture-assistant.md`
and `docs/personal-assistant-architectural-vision.md`. The owner keeps private
decision provenance in the Vault rather than publishing personal conversations.

## Processing and recovery sequence

1. **Recover the task.** Load the owner-selected entrypoint, relevant context map
   and current checkpoint. Establish current intent, corrections, completed work,
   active owner, approval scope and exact next action before asking again.
2. **Discover changes.** Inventory readable sources independently of capture or
   import ledgers. Detect additions/edits by path and content hash; reuse unchanged
   entries. Report coverage and extraction limits, including metadata-only files.
3. **Select evidence.** Retrieve bounded relevant passages and current annotations.
   Preserve path, passage/line locator and source revision. Separate source-event
   date, discovery time and review time. Expand when evidence is insufficient.
4. **Interpret through a replaceable processor.** The model proposes a summary,
   context classification, corrections, questions or actions with source links.
   Keep user statements, source claims, model interpretations and unknowns distinct.
5. **Validate before accepting.** The host checks shape, referenced sources,
   freshness and the applicable approval boundary. Structural validity does not
   prove factual accuracy. A changed source makes its old interpretation stale.
6. **Persist only authorized results.** Store readable derived annotations and a
   checkpoint without replacing originals. Proposed commitments or external
   actions keep their approval gate. Publish failures and partial results honestly.
7. **Resume and verify.** A new run reads the saved checkpoint and current sources.
   It checks existing receipts before repeating work and records its actual result,
   next step and remaining gate. A service restart alone is not a resumed task.

## Visible memory disclosure

Every user-facing answer and question begins with a concise visible memory
disclosure in the language of the reply. State what was actually loaded and the relevant
short-term state: index locator, source excerpt or original read. Report unavailable
memory, stale sources and no retrieval honestly. The line must not claim that the
whole Vault or a whole source was read when only bounded passages were delivered.
Source text remains attributed evidence, not new operating instructions.

The Codex adapter records a readable retrieval receipt containing source paths,
hashes, modes and failures. It provides that evidence to the model. Its final-answer
check can request one correction when the disclosure is missing; it cannot prove
semantic truth or cover every specialized tool/client surface. Supported question
tools are checked before execution. Other clients receive the same requirement
through the protocol/MCP instructions and require their own acceptance test.
The MVP Codex adapter uses the fixed English protocol label `Memory:` followed
by disclosure text in any language. It checks the label and nonempty content,
not the language or meaning of the response. This avoids a per-language label
allowlist; it is not a storage-language restriction or a user language profile.

## Contract coverage and remaining processor work

The historical interface is `runCaptureReview(capturePath)` returning `summary`,
`interpretation`, `questions[]`, `proposals[]`. It is useful prior work, not a
complete enforced contract for incremental memory today.

The following field groups describe the intended boundaries. Retrieval has an
implemented output schema and the local adapter has configuration, event and
receipt checks. The complete model-processor contract is not yet implemented:

| Boundary | Information needed |
| --- | --- |
| Request | Protocol revision; task/checkpoint reference; current request; source revisions and locators; bounded context; applicable approval and execution limits. |
| Processor result | Summary/classification with source references; corrections and uncertainty; coverage; proposed changes; questions only where necessary. |
| Validation result | Accepted/rejected fields and reasons; source-version conflicts; unsupported references; approval requirement; partial/failure state. |
| Persistence receipt | Actual files/revisions written; processor/run provenance; completed action versus proposal; next executable step and waiting decision. |

Further processor-schema changes and automatic semantic publication need their
own compatibility and acceptance checks. Maintaining an index is not blanket
authority to change personal commitments, statuses or plans.
Queue ownership, timeout, retry, budget and interruption recovery belong to the
consumer runtime; their existence in a plan is not evidence that they run.

## Implementation boundary

- The July Assistant implementation had a Codex-backed review adapter behind a
  provider-neutral interface. Working adapters for every provider were not shown.
- Assistant commit `136689e` removed the active model-review adapter on 25 August.
  The architecture and review schema survived. Current conversational review
  placeholders do not demonstrate the former processor is running.
- The context index/library/CLI, MCP schema and optional Codex adapter are in
  source control. Fixture tests and the owner-configured local MCP check passed.
  Discovery and hash freshness are not semantic review of all source contents.
- The initial audit found an old live server without `vault_context_get`.
  After reloading the owner-configured service, SDK discovery/read checks verified
  the new tool and exact context resource. The installed desktop package was not
  rebuilt; source, running service and installed app remain separate.
- MCP `instructions` and readable entrypoint delivery require host consumption.
  The configured local Codex host was observed loading a checkpoint excerpt on
  compaction, and another existing session invoked prompt retrieval. A fresh
  chat and other provider clients still need their own acceptance test.
- `vault_context_get` now advertises an output schema. Annotation field validation
  rejects malformed types/hashes, but does not prove provenance or relationship
  semantics. This remaining work does not require a different memory store.
- The installed SDK advertises protocol support through MCP `2025-11-25`.
  This implementation did not upgrade that SDK/protocol or imply newer behavior.

## Five proposed acceptance outcomes for the next month

These express recovered user intent. The demonstrations below are proposed
acceptance checks, not newly approved dates, numerical SLAs or release authority.

1. **Useful memory survives independently of the assistant.** Open the original
   conversation, current final artifact and meaningful prior/submitted version
   directly from ordinary files. Temporary QA artifacts do not obscure selection.
2. **The right context is recovered without repeating the conversation.** From a
   fresh chat, recover the current task, settled answers, corrections, exact file
   and next step for representative real requests; cite the original evidence.
   Normal retrieval must not require reading every source into the model.
3. **New information becomes discoverable and honestly reviewed.** Save/edit a
   source outside capture flow, observe discovery, then actual semantic processing.
   Stale summaries are withheld or labelled; progress, failures and remaining
   coverage are visible. Prove recovery after an interrupted processing batch.
4. **Changing the agent preserves the work.** Demonstrate the same bounded task
   through a real second host/model, including a local/offline executor where
   supported, using the same readable state and protocol. Verify continuation,
   approval preservation and filesystem/library/MCP retrieval equivalence.
5. **The product can be installed and continued elsewhere.** Deliver a documented,
   approved version with working paths, client setup and upgrade/recovery steps.
   Verify a clean second-machine/client journey and restore a scoped backup.
   Commit, package, installed version and release evidence must be explicit.

## Implementation and activation boundary

The owner authorized implementation and pushing the source after reviewing the
proposal. Local Codex integration is an optional consumer adapter; installing
Vault does not silently enable it. Host hook trust is reviewed through Codex's
normal UI, never fabricated by the installer. Other-client registration, personal
account-wide coverage and new paid processing services are not implied. Keep
runtime, fixture, actual model and installed desktop-release evidence separate.
