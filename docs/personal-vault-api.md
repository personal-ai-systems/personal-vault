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
| `vault_files_trash` | Recoverably moves a file and its `.assets` into Recently Deleted. |
| `vault_files_list_deleted` | Lists recoverable paths and unsupported legacy entries. |
| `vault_files_restore_deleted` | Restores a Recently Deleted file to its original readable path. |

For example, `vault_files_read` returns `raw/2026/08/2026-08-25-ideas.md`, not an internal name.

The API is local by default and should normally listen only on `127.0.0.1`.

`vault_files_read_binary` takes the same readable `path` as text reads and
returns file metadata plus `dataBase64`. It does not import or change the file.
It is an additive preview operation; existing file tools keep their names.
Larger files remain accessible in the ordinary Vault folder.

Recently Deleted is separate from Archive. `vault_files_trash({ path })` moves
the file into `.trash/YYYY-MM-DD/<complete-original-path>` with its adjacent
`.assets` folder. The date is UTC. The lifecycle folder is hidden from ordinary
list/search results, but contains normal readable files, not a database or an
opaque-ID index. Nothing is automatically purged, and there is no permanent
delete endpoint.

`vault_files_list_deleted({ limit? })` returns `{ items, unsupported, truncated }`.
Each supported item has normal file metadata plus `originalPath`, `deletedOn`
(the folder date) and `canRestore: true`. `limit` defaults to 200, accepts 1–1000,
and applies to the combined supported and unsupported results. Paired attachment
folders are not separate results. Inspection also stops after `max(1000, limit × 20)`
filesystem entries, returning `truncated: true` if that budget is exceeded.
Legacy paths such as `.trash/note.md`, orphaned
attachment folders and symlinks remain untouched and are reported as unsupported;
unknown original locations are never guessed. Missing `.trash` is empty; other
filesystem failures are errors. A truncated result is not the complete list.

`vault_files_restore_deleted({ path })` takes the full `.trash/YYYY-MM-DD/...`
path. Both trash and restore refuse an occupied destination, including its
attachment folder, and never silently replace a file. A second deletion of the
same original path on the same UTC day is a collision, not a new version; restore
or manually move the earlier deleted copy before retrying. Source files must be
normal files, not folders, and ordinary containment/symlink checks still apply.
On a filesystem without hard-link support these operations fail safely rather
than falling back to a potentially overwriting move.

Local library equivalents are `trash(relative)`, `listDeleted(limit?)` and
`restoreDeleted(relative)`. They use the same readable paths and result shapes.
