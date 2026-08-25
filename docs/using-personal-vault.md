# Using Personal Vault

Personal Vault should feel like a well-organised personal folder, not a technical system.

Create a Markdown file wherever it makes sense to you. For example:

```text
raw/2026/08/2026-08-25-ideas.md
structured/travel/japan-notes.md
```

If a note has a photo or a PDF, keep it beside the note:

```text
raw/2026/08/2026-08-25-ideas.assets/photo.jpg
```

You can open these files in Finder, Obsidian, VS Code or a normal text editor. The API sees the same files and returns the same paths.

When you archive a file, Personal Vault moves it into `archive/YYYY-MM-DD/`. You can restore it later.

Personal Assistant may read these files and create useful views, but the files remain yours and remain understandable without Personal Assistant.
