# Continuous Development Runner

## Status and Boundary

This document defines the desired 24/7 delivery control plane for Personal Vault development.

The runner is development infrastructure. It is not part of Personal Vault Core, must not ship in the Core runtime and must not weaken the rule that Core contains no autonomous agent orchestration. Its implementation may later live in a separate repository or private operations package under Personal AI Systems.

The objective is continuous, resumable progress whenever all of the following are true:

- a bounded task is approved or belongs to an approved work package;
- the repository and required dependencies are available;
- the selected model/provider account accepts requests;
- no human, compatibility or safety gate is waiting.

“24/7” means event-driven availability and reliable resume, not a busy loop that burns tokens while no useful work is available.

## Human-in-the-Loop Cycle

The default cycle is:

```text
select the next bounded task
-> show scope, expected files and acceptance checks in this chat
-> receive approval
-> execute in an isolated branch/worktree
-> run deterministic checks and independent verification where warranted
-> report exact changes, evidence and any provider-limit stop
-> request approval for the next consequential step
```

One approval may cover several safe, reversible subtasks inside a clearly described work package. The runner must pause before:

- public release or visibility changes;
- destructive or irreversible operations;
- credentials, OAuth grants or persistent-access changes;
- production migrations or changes to an active connector;
- compatibility-breaking API/contract changes;
- legal ownership or licensing changes;
- medical, financial or other high-impact actions.

## Control-Plane Components

### 1. Work queue

Stores bounded tasks with stable IDs, dependencies, acceptance criteria, risk class and approval state. Initial states:

```text
proposed
approved
running
awaiting_verification
awaiting_approval
completed
paused_provider_limit
paused_rate_limit
blocked
cancelled
```

The queue must be durable and restart-safe. A task lease prevents two workers from changing the same scope concurrently.

### 2. Scheduler and heartbeat

Wakes on a queued task, approval event, retry time or repository event. It must use exponential backoff with jitter for transient API/rate-limit failures and must not poll the model continuously when the queue is empty.

### 3. Provider adapter and pause

The runner does not inspect billing, calculate remaining credits, purchase credits or manage provider accounts. It attempts approved work through the currently configured provider. If the provider rejects work because of account credits, quota or availability, the runner must:

1. classify the response as a provider pause rather than a task failure;
2. save the task state and recovery cursor;
3. report the exact stop reason in this chat without exposing credentials;
4. wait for the user to switch or restore the account/model/provider;
5. verify repository state and resume the same approved scope without duplicate mutations.

Account and credit management remain entirely user-owned. Provider credentials stay outside prompts, logs and repository files.

### 4. Worker

Runs one task in an isolated branch/worktree, records every tool/API call needed for provenance, preserves unrelated user changes and never writes to the live Vault for tests. It uses temporary redacted fixtures.

### 5. Verifier

Runs deterministic tests, syntax/type checks, contract fixtures and risk-proportional independent review. It rejects completion when acceptance evidence is missing even if the model claims success.

### 6. Reporter and approval bridge

Posts a compact result into this canonical development chat:

- task and run IDs;
- exact files and behavior changed;
- tests and evidence;
- unresolved risks;
- provider-limit or rate-limit state when relevant;
- commit/branch/PR state;
- recommended next bounded task;
- the exact approval requested.

The approval bridge must be idempotent: repeated delivery of the same user approval cannot execute the task twice.

## Required Records

Every run records:

- task ID, run ID and parent approval/work package;
- repository, base commit, branch and resulting commit;
- model/provider and relevant configuration version;
- start/end timestamps and retry history;
- changed files and diff hash;
- tests, fixtures and evidence artifact IDs;
- approval request and decision reference;
- final state and recovery cursor.

Do not store prompts, outputs or diffs that contain secrets or live Vault contents in a public repository.

## Recovery Rules

- Restart from durable task state, never from a model's conversational memory alone.
- Re-read repository instructions and verify the base commit after every resume.
- If the worktree changed externally, stop and re-plan rather than overwriting it.
- On provider credit/account exhaustion, save the recovery cursor and pause cleanly.
- On rate limits, back off without changing the task's approval scope.
- After repeated identical failures, mark the task blocked and report exact evidence.
- Never treat an interrupted API response as proof that a mutation completed; verify external and Git state.

## Delivery Tracks

Continuous work proceeds on two coordinated tracks:

### Track A — Personal Vault product

Execute the Core/Assistant evidence gates in `AGENTS.md`, beginning with the ownership/dependency inventory and Core contract v1.

### Track B — Delivery control plane

1. Freeze task, approval, provider-pause, evidence and recovery schemas.
2. Implement a local single-worker dry-run with a fake provider.
3. Add isolated Git worktree execution and deterministic verification.
4. Add a chat approval adapter with idempotent decisions.
5. Add provider adapters that convert credit/account/rate-limit responses into durable pause states.
6. Add restart recovery, leases, backoff and audit records.
7. Run unattended acceptance drills with provider-limit responses, rate limits, failed tests and restarts.
8. Only then enable continuous real-model work under a user-managed provider account.

## Definition of Done

The continuous runner is ready when it can repeatedly:

1. receive an approved bounded task;
2. execute in an isolated workspace;
3. stop safely on provider limits, rate limits, approval or compatibility gates;
4. recover after process restart without duplicate mutations;
5. produce deterministic verification and an auditable report in this chat;
6. recommend the next bounded step without automatically expanding scope;
7. prove through failure drills that no credential, live Vault data or public release can occur without the required approval.
