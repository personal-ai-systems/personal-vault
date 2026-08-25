# Personal Vault

## The idea

Personal Vault is a normal folder that belongs to its user.

The files in that folder are the product. A person must be able to open the folder in Finder, read a note in any Markdown editor, move it, back it up and understand what is there without an app or an account.

The API and MCP server are a helpful doorway to those same files. They must not create a second hidden storage system.

## Keep it simple

- Markdown notes and normal attachments are the source of truth.
- Keep meaningful names and folders such as `raw/2026/08/` and `structured/`.
- Return readable paths from the API, never internal names.
- Save attachments beside their Markdown file in a visible `.assets` folder.
- Search the files themselves. A temporary cache is optional and must never be required to read the Vault.
- Archive by moving a file into the visible `archive/` folder. Do not permanently delete user files during normal use.
- Personal Vault stores files. Personal Assistant decides what Health, Today, Planner or projects mean.

## Before changing code

1. Test only against a temporary folder.
2. Do not touch a real Vault unless the user explicitly asks.
3. Keep the public API small: list, read, create, update, search, attach, archive and restore.
4. Do not introduce hidden storage formats, internal names, or application-specific concepts.
5. Do not commit personal files, tokens, backups or logs.
