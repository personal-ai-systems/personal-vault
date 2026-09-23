# Personal Vault

Personal Vault is a simple, local folder for your notes and files.

Open it in Finder. Read the Markdown. Keep your own backups. Use any editor you like.

The optional MCP server lets an app or AI assistant browse and edit the same readable files safely. It does not replace the folder with a hidden system.

## What a Vault looks like

```text
personal-vault/
├── raw/2026/08/              # captured notes
├── structured/               # user-readable supporting files
├── archive/                  # files you archived and can restore
└── raw/.../note.assets/      # attachments beside a note
```

You choose the folders. Personal Vault does not require this exact layout.

## Run locally

```sh
PERSONAL_VAULT_ROOT=/path/to/your/personal-vault \
MCP_HOST=127.0.0.1 \
MCP_PORT=8788 \
npm run mcp:vault
```

The local endpoint is `http://127.0.0.1:8788/mcp`. It is the only MCP endpoint. Tool names use underscores (for example `vault_files_read`) because some model providers reject dots in function names.

## What the API can do

- list folders and files;
- read Markdown, text and JSON files;
- create and update readable files;
- search text;
- save attachments beside Markdown;
- archive and restore files.

See [Using Personal Vault](docs/using-personal-vault.md) and [API overview](docs/personal-vault-api.md).

## Development

```sh
npm test
npm run scan:secrets
```

Tests always use a temporary folder, never your real Vault.
