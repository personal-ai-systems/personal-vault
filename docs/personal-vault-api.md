# Personal Vault API overview

The API uses readable file paths.

Every tool is served from a single MCP endpoint at `/mcp`. Tool names use underscores, because several model providers reject dots in function names.

| Tool | What it does |
| --- | --- |
| `vault_files_list` | Shows files and folders. |
| `vault_files_read` | Reads a Markdown, text or JSON file. |
| `vault_files_read_binary` | Reads an attachment for local preview (up to 10 MiB). |
| `vault_files_create` | Creates a readable file at a chosen path. |
| `vault_files_update` | Replaces the text in an existing file. |
| `vault_files_search` | Searches text in the Vault. |
| `vault_files_attach` | Saves an attachment beside a Markdown file. |
| `vault_files_archive` | Moves a file into `archive/`. |
| `vault_files_restore` | Moves an archived file back. |

For example, `vault_files_read` returns `raw/2026/08/2026-08-25-ideas.md`, not an internal name.

The API is local by default and should normally listen only on `127.0.0.1`.

`vault_files_read_binary` takes the same readable `path` as text reads and
returns file metadata plus `dataBase64`. It does not import or change the file.
It is an additive preview operation; existing file tools keep their names.
Larger files remain accessible in the ordinary Vault folder.
