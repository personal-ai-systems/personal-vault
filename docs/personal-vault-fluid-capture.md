# Personal Vault Fluid Capture Principle

This document describes the end-to-end capture experience across Personal Vault Core and Personal Assistant. It does not assign domain interpretation to Core.

- Core saves the exact raw capture and attachments, preserves provenance, and exposes generic retrieval and approved-mutation contracts.
- Personal Assistant owns capture review, Health/Today/Planner/project interpretation, clarification questions, proposals and approval UI.
- The current MCP server still performs some Assistant work as a temporary compatibility adapter. That code is migration debt and must not define the final Core contract.

Personal Vault should treat input as fluid memory, not as a form that the user must classify.

The user should be able to save anything:

- a voice note,
- a photo description,
- a meal,
- a workout,
- a medical observation,
- a decision,
- a task,
- an architecture thought,
- a messy conversation summary.

The capture layer must stay simple:

```text
capture_note(input, optional hints)
-> raw readable Markdown
-> append-only vault
-> status: unreviewed/proposed/applied
```

Do not require the user to choose a schema such as nutrition, workout, project, task, or decision before saving.

## Processing Layer

After raw capture is saved, an Assistant-owned AI processor reviews it against the current Personal Vault context and project/dashboard structure.

The processor may be local, Codex-backed, ChatGPT-backed, another model, or a future service. The implementation can change. The contract should stay stable:

```text
new raw capture
-> processor reads capture + relevant vault context
-> processor returns proposals and minimal clarification questions
-> user approves one or more proposals
-> generic apply action updates derived dashboard/project state
```

This is intentionally similar to an AI-native database layer: raw memory remains human-readable, while derived state is created by an AI process that understands the system.

The cross-product architecture may call this abstraction `runCaptureReview`, not `runCodexCaptureReview`. It belongs behind the Personal Assistant contract, not inside the final neutral Core runtime. Codex is only the current MVP provider. Later providers may be OpenAI API, another hosted model, Ollama/LM Studio, or a separate local service.

The current provider contract is:

```text
runCaptureReview(capturePath)
-> summary
-> interpretation
-> questions[]
-> proposals[]
```

If the selected provider times out or fails, `capture_note` should still return a useful response based on a lightweight fallback review rather than failing the whole tool call.

## Heartbeat Review Bridge

This is a transitional compatibility flow, not the target Core architecture.

For a live Codex-agent workflow, a heartbeat automation can review new captures in this existing Codex thread instead of spawning a new `codex exec` process per capture.

The bridge works like this:

```text
ChatGPT calls capture_note
-> raw Markdown is saved
-> heartbeat automation wakes in this Codex thread
-> Codex reads unreviewed captures
-> Codex writes review JSON to indexes/codex-capture-reviews/
-> ChatGPT calls get_capture_review(capturePath)
```

This is not push into ChatGPT. ChatGPT cannot see this Codex thread directly. The bridge back to ChatGPT is the MCP `get_capture_review` tool, which reads the saved review artifact from the vault.

## Synchronous MCP Flow

The current compatibility flow is synchronous:

```text
ChatGPT calls capture_note.
capture_note saves raw Markdown.
capture_note immediately calls a proposal processor.
capture_note returns proposed next actions and questions to ChatGPT.
ChatGPT asks the user what to apply.
apply_capture_action applies only approved generic changes.
```

Example proposal language:

```text
Saved raw capture.

I think this affects:
1. Health / activity
2. Today dashboard

I need one clarification:
- roughly how large was the portion?

Apply this after clarification?
```

## Generic Actions

Public MCP/API actions should stay generic.

The examples below describe Assistant-owned proposals sent through a generic Core mutation envelope. Core may validate the envelope, provenance and permission policy, but it must not understand `health`, `activity_log`, calories or Today semantics.

Good:

```json
{
  "actionId": "apply-structured-update",
  "projectId": "health",
  "processorId": "health.activity",
  "recordType": "activity_log"
}
```

Avoid public contracts like:

```text
log-health-workout
apply-health-workout
log-food
apply-car-task
```

Project-specific interpretation belongs behind `processorId`, not in a growing list of public endpoints.

## Minimal Questions

The processor should ask only when information is necessary for a useful update.

For food photos, examples of minimal questions:

- portion size,
- hidden calorie-dense items such as oil, sauce, nuts, cheese, alcohol,
- whether this was the full meal or only part of it.

For exercise, examples:

- duration if cardio was mentioned without time,
- load/sets/reps only when needed,
- pain response if relevant to rehab progression.

If the capture is useful but incomplete, keep the raw capture and return a question instead of forcing a bad structured update.

## Derived State Is Secondary

Raw Markdown is the source of truth.

Dashboard state, project indexes, summaries, energy estimates, and plan updates are derived views. They can be rebuilt later by a better processor.

The system should optimize for:

- low-friction capture,
- human-readable raw memory,
- AI-assisted routing and transformation,
- user approval before meaningful mutation,
- easy replacement of the processor implementation.
