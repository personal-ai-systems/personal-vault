# Personal Assistant to Personal Vault API Migration Update

Status date: 25 August 2026
Scope: next ten bounded tasks, each intended to fit within one working day
Primary outcome: the public Personal Assistant MCP/ChatGPT path no longer reads or writes the Vault filesystem directly

## Product boundary

Personal Vault is the only component that physically reads and writes canonical Vault records and assets. It owns readable records, stable IDs, revisions, provenance, audit history, generic search, export, backup, restore and integrity checks.

Personal Assistant owns interpretation and workflows: capture review, Today, Planner, Health, projects, recommendations and model orchestration. It may store its source and derived artifacts in Personal Vault, but only through domain-neutral `personal-vault/v1` operations. Personal Vault treats Assistant metadata and content as opaque data.

The target runtime is:

```text
ChatGPT mobile/web
  -> public Personal Assistant MCP (existing URL and tools)
  -> Assistant domain logic
  -> private Personal Vault MCP client
  -> Personal Vault MCP (`personal-vault/v1`, `vault.*`)
  -> Vault filesystem
```

The public Assistant connector stays on its current endpoint. The separate Personal Vault MCP initially runs on loopback only and must not be exposed through the public tunnel.

## Verified current state

### Completed

- Personal Vault is a separate repository at `/Users/kirill/development/personal/personal-vault`.
- Personal Assistant remains at `/Users/kirill/development/personal/personal-dashboard`.
- The neutral `personal-vault/v1` contract and `vault.*` namespace exist.
- Personal Vault currently implements generic create, get, revise, lifecycle mutations, asset attachment, search, change feed, integrity checking, export, encrypted backup/restore and index rebuild.
- The Personal Vault fixture suite passes: 38 tests, 0 failures, plus the real companion-MCP smoke test.
- The public Assistant connector remains on its existing URL and tool names; its running local service reports `server: personal-assistant` on `/healthz`.
- Personal Vault contains no Health, calorie, workout, Today, Planner or project-specific tools.
- The Assistant has a typed `personal-vault/v1` client with bounded timeout, structured errors and clean shutdown.
- `capture_note`, `capture_asset`, `search_vault`, capture reviews/proposals, approved actions and `get_today_plan` use the Vault API. Assistant-owned meaning is stored in opaque `assistant.*` metadata and readable records.
- The Assistant MCP source has no filesystem imports or legacy Vault paths; a boundary test enforces this.
- A private loopback-only Vault MCP now runs on `127.0.0.1:8788`; the public Assistant MCP remains on `127.0.0.1:8787` and connects to it internally.
- A non-destructive migration imported 878 readable legacy source files plus the current Today projection into the new Vault store. Legacy files remain untouched.

### Not completed

- The remaining Assistant web routes, libraries and scheduled/import scripts still contain legacy filesystem access. They are outside this ten-task public-MCP vertical slice and must migrate in later batches.
- A fresh mobile/web ChatGPT conversation has not yet been executed through the connector UI. Local and tunnel health checks pass, but a signed-in UI acceptance remains required.
- Legacy binary assets remain in their original folders. New attachments use `vault.assets.attach`; a later migration should import historical assets without deleting their originals.

### Working-tree protection

The following Personal Assistant files already contain unrelated user changes. Do not overwrite, discard, reformat or stage them unless the task explicitly requires a surgical edit and the diff has been reviewed:

- `app/api/health/calorie-calibration/route.ts`
- `app/api/planner/route.ts`
- `app/api/wealth/stocks-monitor/route.ts`
- `components/HealthView.tsx`
- `components/PlannerView.tsx`
- `components/ProjectView.tsx`
- `components/StocksMonitorPanel.tsx`
- `scripts/generate-daily-projection.mjs`

## Global rules for every task

1. Read both repositories' `AGENTS.md` files and inspect both Git states before editing.
2. Use only temporary redacted Vault fixtures in tests. Never point tests at `/Users/kirill/personal-vault`.
3. Do not change the public Assistant connector URL or its tool names during tasks 1-9.
4. Do not add Health, Today, Planner, project or model concepts to Personal Vault operations or schemas.
5. Preserve raw source material, provenance, idempotency, revision checks and audit history.
6. Make every change reversible and keep legacy data untouched until verified migration and rollback evidence exist.
7. Do not restart services, edit LaunchAgents, migrate live data, change credentials or publish anything without explicit user approval.
8. End each task with executed checks, exact changed files, remaining risk and a narrow commit. Do not stage unrelated working-tree changes.

## The next ten tasks

### Task 1 — Add the missing neutral read contract

Estimated size: 4-6 hours
Repository: Personal Vault

Copyable task prompt:

> Read both `AGENTS.md` files and `docs/personal-vault-api-migration-update.md`. In Personal Vault, add the smallest domain-neutral API additions required by an external client: paginated `vault.records.list` with lifecycle and exact namespaced-metadata filters, and `vault.assets.get` returning asset metadata plus payload in a transport-safe form. Update the contract document and machine-readable schema, then add fixture tests before or with the runtime implementation. Do not add path-based identities or Assistant-specific fields. Run the complete Vault test suite and domain-term audit. Commit only Personal Vault changes.

Acceptance:

- listing uses opaque cursors and stable record IDs;
- metadata filters treat values as opaque exact matches;
- asset retrieval validates `assetId` and payload hash;
- old v1 tools remain compatible;
- all Vault tests pass.

### Task 2 — Prove a separate internal Vault MCP process

Estimated size: 2-4 hours
Repository: Personal Vault

Copyable task prompt:

> Add a fixture-based smoke test and documented local configuration for running Personal Vault MCP as a second loopback-only process, using port 8788 by default in the example while Personal Assistant keeps port 8787. Start the Vault process only against a temporary fixture, perform MCP initialize/tool discovery and one generic create/get round trip, then stop it. Do not edit or load a LaunchAgent and do not touch the live Vault. Keep Google authentication behavior unchanged; document that the initial companion service is loopback-only.

Acceptance:

- the smoke test starts and stops its own temporary process;
- tool discovery returns only `vault.*` tools;
- no public tunnel or live data is used;
- the existing 34+ contract tests remain green.

### Task 3 — Add a typed Personal Vault client to Assistant

Estimated size: 4-6 hours
Repository: Personal Assistant

Copyable task prompt:

> Add a reusable Personal Vault MCP client module to Personal Assistant using the installed Model Context Protocol SDK. Configure it with `PERSONAL_VAULT_MCP_URL`, defaulting to `http://127.0.0.1:8788/mcp` only for local development. Expose typed methods for create, get, list, search, attach asset, append mutation and list changes. Add connection timeout, structured errors and clean transport shutdown. Test it against the temporary Vault MCP fixture from Task 2. Do not change any existing Assistant route or public MCP tool yet.

Acceptance:

- no filesystem import exists in the new client;
- connection failure is explicit and bounded by timeout;
- client integration tests exercise real MCP transport;
- Assistant syntax/dependency checks pass.

### Task 4 — Migrate `capture_note` behind a feature flag

Estimated size: 4-6 hours
Repository: Personal Assistant

Copyable task prompt:

> Refactor only the raw-record persistence part of `capture_note` to use the Personal Vault client. Keep Assistant interpretation and proposal generation in Personal Assistant. Preserve the public `capture_note` input and response shape. Store readable Markdown, source provenance and opaque namespaced Assistant metadata through `vault.records.create`. Add `ASSISTANT_VAULT_API_ENABLED=false` as a temporary rollback flag and fixture tests comparing legacy and API-backed responses. Do not change the live environment or remove the legacy path yet.

Acceptance:

- API mode creates a readable generic Vault record with stable `recordId`;
- Assistant owns all proposal/domain fields;
- replay uses a stable idempotency key;
- legacy mode remains available for rollback;
- tests never access the live Vault.

### Task 5 — Migrate capture assets

Estimated size: 3-5 hours
Repository: Personal Assistant

Copyable task prompt:

> Replace `capture_asset` and the attachment portion of `capture_note` with `vault.assets.attach` through the shared client when the feature flag is enabled. Preserve existing public tool responses while adding stable `recordId` and `assetId` where backward compatible. Validate MIME type, byte length and SHA-256 before sending. Add fixtures for a valid image, generic binary attachment, bad hash, duplicate request and rollback. Keep the old filesystem implementation only as the disabled rollback path.

Acceptance:

- API mode performs no direct asset filesystem write;
- asset provenance and the source-record relationship survive;
- duplicate calls are idempotent;
- invalid payloads leave no record revision or asset behind.

### Task 6 — Migrate Assistant search and record reads

Estimated size: 4-6 hours
Repository: Personal Assistant

Copyable task prompt:

> Migrate the storage part of `search_vault` to `vault.records.search` and record retrieval to `vault.records.get/list`. Keep Health, Today, Planner and project-aware ranking/presentation in Personal Assistant after generic records are returned. Remove hard-coded filesystem walking from these API-enabled paths. Add compatibility fixtures covering plain Markdown, archived records, Assistant metadata and empty results. Preserve the public tool name and response shape.

Acceptance:

- Personal Vault performs only generic matching/filtering;
- Assistant performs all domain interpretation;
- API mode does not walk `VAULT_ROOT`;
- legacy mode remains a temporary rollback path.

### Task 7 — Store capture reviews and proposals as generic records

Estimated size: 4-6 hours
Repository: Personal Assistant

Copyable task prompt:

> Change capture-review and proposal persistence to generic Personal Vault records with derivation provenance, source record IDs, processor identity/version and namespaced Assistant metadata. Migrate `get_capture_review` in API mode to exact metadata lookup instead of `indexes/capture-proposals`. Keep proposal schemas and meanings entirely in Personal Assistant. Add fixtures for no proposal, multiple proposals, processor version, source linkage and approval evidence. Do not migrate live proposal files.

Acceptance:

- every proposal points to its source record ID;
- Personal Vault sees only opaque content and metadata;
- `get_capture_review` no longer reads proposal files in API mode;
- fixture tests prove deterministic lookup.

### Task 8 — Route approved Assistant actions through generic mutations

Estimated size: 4-6 hours
Repository: Personal Assistant

Copyable task prompt:

> Refactor the storage boundary of `apply_capture_action`: Personal Assistant continues to validate and execute the selected domain action, but all resulting canonical record writes use approved `personal-vault/v1` mutations through the shared client. Include source record IDs, proposal ID, explicit approval evidence, actor, processor version and idempotency key. Add fixtures for approval required, expired approval, revision conflict, replay and rejected action. Do not teach Personal Vault any action name such as Health, Today or Planner.

Acceptance:

- no domain action is applied without explicit approval evidence;
- resulting writes are generic revisions/records with audit events;
- revision conflicts are surfaced without overwrite;
- rejected actions leave the fixture unchanged.

### Task 9 — Migrate `get_today_plan` to an Assistant-owned projection record

Estimated size: 4-6 hours
Repository: Personal Assistant

Copyable task prompt:

> Define an Assistant-owned Today projection record stored through Personal Vault as opaque readable content plus namespaced metadata. Update the projection writer and `get_today_plan` API-enabled reader to use the shared Vault client. Personal Assistant remains responsible for Health expansion, task grouping and presentation. Work carefully around the existing uncommitted change in `scripts/generate-daily-projection.mjs`; preserve it and show the combined diff before staging. Add fixture tests for projection present, missing, stale and revised.

Acceptance:

- API-enabled `get_today_plan` performs no direct Vault filesystem read;
- the projection has derivation provenance and source record IDs;
- Vault code contains no Today/Planner/Health vocabulary;
- existing working-tree changes remain intact.

### Task 10 — Remove MCP filesystem access and perform the controlled cutover

Estimated size: 4-8 hours plus user acceptance time
Repositories: both; service/UI changes require explicit approval

Copyable task prompt:

> First add an architectural test that fails if `mcp/personal-assistant-server.mjs` imports filesystem APIs, constructs `VAULT_ROOT` paths or reads legacy `raw/structured/indexes` locations. Remove those MCP filesystem paths only after Tasks 4-9 pass in API mode. Run both servers locally with a redacted fixture and execute the full Assistant MCP compatibility plan. Present evidence and request explicit approval before editing/reloading the LaunchAgent or changing the live feature flag. After approval, keep the existing public Assistant URL and tool names, point Assistant to the loopback Personal Vault MCP, restart only the known Assistant service, then verify a fresh ChatGPT connector conversation can call `get_today_plan` and `capture_note`. Retain rollback configuration and do not delete legacy data.

Acceptance:

- the Assistant MCP source has no Vault filesystem access;
- Personal Vault is the only process that touches the fixture Vault storage;
- public Assistant tools remain discoverable and compatible;
- mobile/web ChatGPT acceptance passes in a fresh conversation;
- rollback is documented and tested;
- no legacy file is deleted.

## State after Task 10

Task 10 completes the first shippable vertical slice: ChatGPT -> Personal Assistant MCP -> Personal Vault MCP -> filesystem. It does not honestly complete the entire Assistant application migration.

Afterward, the remaining Assistant web routes, libraries and import/scheduled scripts that reference `VAULT_ROOT` must be split into additional sub-day batches using the same client. Suggested order is:

1. generic file browser, content, recent, search and asset routes;
2. capture, transcript, day and review routes;
3. Today and Planner routes;
4. Health routes and libraries;
5. projects, Resume and Trading routes;
6. import and scheduled projection scripts.

The final application-level completion check is:

```sh
rg -n "PERSONAL_VAULT_ROOT|VAULT_ROOT|~/personal-vault|/Users/.*/personal-vault" \
  app lib mcp scripts
```

Every remaining match must be either removed or explicitly documented as non-storage configuration. Do not claim the strict API boundary before this audit is clean and the full Assistant regression suite passes.

## Current next action

The ten-task public-MCP vertical slice is implemented. Run a fresh signed-in ChatGPT mobile/web connector conversation using `get_today_plan` and `capture_note`, then begin the next batch: the Assistant web routes and scheduled scripts listed above.
