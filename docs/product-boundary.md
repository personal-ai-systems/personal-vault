# Personal Vault — product boundary

Confirmed 30 October 2026. This is the current product decision for both the
Vault repository and its independent desktop client. Older mixed-product plans
do not override it.

## Personal Vault is the memory store

Personal Vault stores a person's memory: what happened, conversations,
documents, images and other material the person chooses to keep. It is
independent of Personal Assistant, dashboards, model providers and agent hosts.

Its source of truth is a normal, readable folder of Markdown and attachments.
Calling it a memory database describes its purpose as a data store; it does not
require SQL, opaque records, mandatory metadata or another hidden storage format.

If every Assistant, model and app disappears, the person must still have useful,
understandable files. An optional index/cache cannot become the only copy.

## The products have different jobs

| Personal Vault and its file client | Personal Assistant or another consuming client |
| --- | --- |
| Save, read, browse, search and edit saved memory/files | Interpret meaning and decide what matters now |
| Import/export, attachments and readable paths | Generate summaries, recommendations or proposed actions |
| Archive, recoverable deletion, backup and restore | Own Today, Planner, Health, goals and project workflows |
| Provide neutral shared-library and optional API/MCP access | Choose models, assemble task context and execute approved work |
| Show saved content and dates without interpreting it | Schedule check-ins, notifications and bounded agents |

Assistant-generated files may be stored in the Vault as ordinary source material.
Their physical presence does not give Vault ownership of the logic that creates
or interprets them. Do not move or delete a person's historical content merely
because it discusses Assistant, Health, a plan or an earlier architecture.

## A Vault UI is not an Assistant

The independent desktop client is a human interface to the memory store. Its
scope is selecting a folder and browsing, finding, importing, editing and
recovering files. It must work without installing Personal Assistant, choosing
a model, opening an AI account or running a planning workflow.

Ordinary navigation is Recent, Memory and Files, followed by separate Recently
Deleted and Archive. As clarified on 1 November 2026, Files is the original
folder/file browser rooted at the selected Vault, including technical folders.
Memory and Recent keep the simpler content views; the default home is Recent.
Search follows the selected section. Files searches across the whole visible
Vault tree, with relative paths shown in results; it is not limited to the open
folder. No filesystem layout or content changes follow from this presentation.
Keep these controls understandable without changing the product into a daily
dashboard. Do not use an everyday-assistant, executive-mode or second-brain
metaphor as the Vault's product identity.

Current presentation: **Personal Vault — Your memory, in files you own.**
Design-system names describe implementation, not the purpose of the product.
An easy-to-use file client is still required; this decision does not remove it.

## Independence and access

- Vault and its desktop client must install and operate without the Assistant
  repository or an Assistant runtime.
- Local clients may use the shared Vault library or authorised filesystem access.
  MCP/public hosting is not mandatory for local use.
- Remote clients need their own configured, authenticated connection. Installing
  Vault does not silently register clients, upload memory or archive all chats.
- Neutral date grouping and a date utility are not Today/Planner logic.
- Memory is the ordinary product term. Existing API/function names may retain
  compatibility names; do not break a connector to enforce UI vocabulary.

## Known compatibility exception, not approved target behaviour

The Vault MCP currently retains legacy Assistant-facing tools and plan-review
behaviour. That is documented migration debt, not permission to add more domain
logic. The file library and desktop client must not depend on those semantics.

Before retiring active tools: inventory consumers, provide the neutral/Assistant
replacement, test the same user journey and obtain approval for the breaking
change. Do not claim full runtime detachment until this exception is removed and
real-client compatibility is verified.

Unused Assistant implementations in the UI are not a compatibility requirement.
Remove those copies while retaining explicit rejection of their old route paths.

## Handling conflicting documents

1. Current entrypoints, READMEs and checkpoints must point to this decision.
2. An old plan assigning execution, resurfacing or a daily dashboard to Vault is
   historical mixed-product context. Those responsibilities belong to Assistant.
3. Preserve original statements and their dates. Add a clear ownership or
   supersession notice; do not rewrite raw history as though the old discussion
   never happened, silently cancel tasks or change approval/completion records.
4. Do not restart old Core extraction, hidden-record contracts or date-driven
   roadmaps because a saved document still contains them.

## Acceptance

- A clean Vault install opens an existing readable folder without Assistant.
- Files saved through an editor, the UI or generic tools remain readable and
  discoverable; optional headers and indexes are not prerequisites.
- No Vault screen or neutral file operation computes Health/Planner/Today
  semantics, recommends a next action or starts an agent.
- The UI source does not ship obsolete Resume Me/Today/check-in implementations;
  old Assistant routes remain rejected.
- Product docs and review artifacts describe the memory store, not an everyday
  Assistant. Source, tested package, installed app and published release remain
  distinct claims.

Read this decision before accepting an architectural or positioning change.
See the separate [target-state review](personal-vault-target-state-review.md)
for dated findings, not a competing product definition.
