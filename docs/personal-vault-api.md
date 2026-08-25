# Personal Vault API overview

The API uses readable file paths.

| Tool | What it does |
| --- | --- |
| `vault.files.list` | Shows files and folders. |
| `vault.files.read` | Reads a Markdown, text or JSON file. |
| `vault.files.create` | Creates a readable file at a chosen path. |
| `vault.files.update` | Replaces the text in an existing file. |
| `vault.files.search` | Searches text in the Vault. |
| `vault.files.attach` | Saves an attachment beside a Markdown file. |
| `vault.files.archive` | Moves a file into `archive/`. |
| `vault.files.restore` | Moves an archived file back. |

For example, `vault.files.read` returns `raw/2026/08/2026-08-25-ideas.md`, not an internal name.

The API is local by default and should normally listen only on `127.0.0.1`.
