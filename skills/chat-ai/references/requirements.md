# Agreed requirements and boundaries

Generic integration requirements distilled from assistant workflow failures.
Personal settings and task histories are deliberately not included. Version 0.1.2.

| Requirement | Implementation | Not claimed |
| --- | --- | --- |
| AI is the Brain; Vault is external memory | SKILL.md role boundary | Vault is not an autonomous decision-maker |
| Provider independence | Readable Markdown and portable ZIP | All providers are already configured |
| Stop repeating settled instructions | Persistent entrypoint and installed skill | Perfect instruction following |
| Keep chat-local scope separate from enduring rules | Private profile bindings and recent-context policy | Deleting history already sent by a host |
| Stay on current request | Turn checks and scoped retrieval | Full Vault scan on every message |
| Ask questions one at a time | One blocking clarification, then wait | A mandatory questionnaire |
| Step-by-step review | Guided execution checkpoint: prepare, show, ask once, wait, apply and persist | Proceeding without the user's checkpoint answer |
| Show how the skill works | Inspect version, entrypoint and evidence when asked | Starting a questionnaire instead of explaining implementation |
| Continue existing work | Reconcile the original outcome, prior decisions and saved checkpoint | Replacing an existing plan or starting intake again |
| Work, do not just describe work | Execute authorized tasks and verify outcomes | Unapproved decisions or submissions |
| Approval because context may be missing | Consequential decisions stay approval-gated | Broad access waives risk controls |
| Reduce user effort and preserve continuity | Relevant task state in readable Vault notes | A new mandatory task schema or database |
| Continue while user is unavailable | Honest handoff to a configured scheduler | Markdown starts a background worker |
| Reviewable, editable files and backup | Route to personal-workflow | An upload preview proves editability |
| External browser only | Host/user-configured browser workflow | App click settings were changed |
| Keep Daily Capture scoped | Route to daily-capture; honor explicit scope override | Force a new chat after user says execute here |
| Share and version the skill | Local Git-ready source, allowlisted archive, hashes | Public publication or a remote is authorized |

## Scope of v0.1.2

Install the protocol in a configured Codex filesystem environment and provide a
portable package plus repeatable installation checks. Do not modify unrelated
projects, tasks, provider settings or authentication. A support request is a
separate task and is not reusable authorization to send further complaints.

Future runtime controls (background jobs, budget enforcement, automatic state
injection before every inference) require explicit implementation and their own
tests. They are not represented as complete by installing this skill.
