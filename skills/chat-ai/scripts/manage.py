#!/usr/bin/env python3
"""Install/check a bounded skill, or export only its reviewed source files."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from datetime import datetime, timezone
import zipfile

VERSION = "0.1.1"
FILES = (
    ".gitignore", "SKILL.md", "INSTALL.md", "agents/openai.yaml",
    "references/requirements.md", "references/acceptance.md",
    "scripts/manage.py", "tests/test_manage.py",
)
BEGIN = "<!-- chat-ai:begin -->"
END = "<!-- chat-ai:end -->"
RECEIPT = ".chat-ai-install.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def no_symlink(path):
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError(f"Refusing symlink path: {part}")


def payload(source):
    result = {}
    for name in FILES:
        path = source / name
        no_symlink(path)
        result[name] = path.read_bytes()
    return result


def routing(skill_path, profile=None):
    return (
        f"{BEGIN}\n"
        "## Chat AI operating protocol\n\n"
        f"Apply `{skill_path}` to every user turn before selecting domain tools. "
        "Read the full skill at session start, after context compaction/loss, "
        "or after its revision changes; otherwise apply the already-loaded "
        "revision without repetitive file reads. The AI assistant is the Brain; "
        "Personal Vault is external memory. Respect current intent, scoped "
        "approvals and specialist workflows. An explicit request to execute "
        "the current task here overrides a suggestion to transfer chats; "
        "do not repeat that suggestion as a blocker. Do not claim background "
        "execution or cross-client activation from these instructions alone.\n"
        + (f"Read local operating profile `{profile}` at the same checkpoints. "
           "Apply conversation-specific bindings only to the matching chat; "
           "keep that file out of exported skill packages.\n" if profile else "")
        +
        f"{END}"
    )


def updated_rules(original, block):
    if BEGIN not in original and END not in original:
        separator = "" if not original or original.endswith("\n\n") else (
            "\n" if original.endswith("\n") else "\n\n")
        return original + separator + block + "\n"
    if original.count(BEGIN) != 1 or original.count(END) != 1:
        raise ValueError("Ambiguous Chat AI routing markers; no files changed")
    start, end = original.index(BEGIN), original.index(END)
    if start >= end:
        raise ValueError("Reversed Chat AI routing markers; no files changed")
    return original[:start] + block + original[end + len(END):]


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    no_symlink(path)
    fd, temp = tempfile.mkstemp(prefix=".chat-ai-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        if path.exists():
            os.chmod(temp, path.stat().st_mode & 0o777)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def manifest(data):
    return {"skill": "chat-ai", "version": VERSION,
            "sha256": {name: digest(body) for name, body in data.items()}}


def install(source, home, vault=None, replace=False, profile=None):
    data = payload(source)
    dest = home / "skills" / "chat-ai"
    no_symlink(dest)
    if source.resolve() == dest.resolve():
        raise ValueError("Run from the canonical source, not the installed copy")
    if profile is not None:
        no_symlink(profile)
        if not profile.is_file():
            raise ValueError("Local profile must be an existing readable file")
        profile.read_text()
    receipt_path = dest / RECEIPT
    no_symlink(receipt_path)
    previous = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
    known = previous.get("sha256", {})
    writes = []
    # Preflight every managed file and rule before any mutation.
    for name, body in data.items():
        path = dest / name
        no_symlink(path)
        if path.exists():
            current = path.read_bytes()
            if current == body:
                continue
            if not replace and digest(current) != known.get(name):
                raise ValueError(f"Unmanaged/local edit: {path}; inspect before --replace")
        writes.append((path, body))
    entrypoints = [home / "AGENTS.md"]
    if vault is not None:
        if not vault.is_dir():
            raise ValueError("Vault root must be an existing directory")
        entrypoints.append(vault / "AGENTS.md")
    for path in dict.fromkeys(entrypoints):
        no_symlink(path)
        override = path.with_name("AGENTS.override.md")
        if override.exists() and override.stat().st_size:
            raise ValueError(f"Active override masks entrypoint: {override}")
        old = path.read_bytes() if path.exists() else b""
        new = updated_rules(old.decode(), routing(dest / "SKILL.md", profile)).encode()
        if new != old:
            writes.append((path, new))
    record = (json.dumps(manifest(data), indent=2) + "\n").encode()
    if not receipt_path.exists() or receipt_path.read_bytes() != record:
        writes.append((receipt_path, record))
    backup_root = home / "backups" / "chat-ai"
    no_symlink(backup_root)
    backup = None
    if any(path.exists() for path, _ in writes):
        backup_root.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-")
        backup = Path(tempfile.mkdtemp(prefix=stamp, dir=backup_root))
        mapping = {}
        for index, (path, _) in enumerate(writes):
            if path.exists():
                name = f"{index:03d}-{path.name}"
                shutil.copy2(path, backup / name)
                mapping[name] = str(path)
        atomic_write(backup / "restore-map.json",
                     (json.dumps(mapping, indent=2) + "\n").encode())
    for path, body in writes:
        atomic_write(path, body)
    return {"installed": str(dest), "changed": [str(p) for p, _ in writes],
            "backup": str(backup) if backup else None,
            "verification": check(source, home, vault, profile)}


def check(source, home, vault=None, profile=None):
    data = payload(source)
    dest = home / "skills" / "chat-ai"
    errors = []
    for name, body in data.items():
        path = dest / name
        no_symlink(path)
        if not path.exists() or path.read_bytes() != body:
            errors.append(f"Missing/different installed file: {name}")
    record = dest / RECEIPT
    no_symlink(record)
    if not record.exists() or json.loads(record.read_text()) != manifest(data):
        errors.append("Installed manifest missing/different")
    paths = [home / "AGENTS.md"] + ([vault / "AGENTS.md"] if vault else [])
    if profile is not None:
        no_symlink(profile)
        if not profile.is_file():
            errors.append("Local profile missing")
    expected = routing(dest / "SKILL.md", profile)
    for path in dict.fromkeys(paths):
        no_symlink(path)
        override = path.with_name("AGENTS.override.md")
        if override.exists() and override.stat().st_size:
            errors.append(f"Active override masks entrypoint: {override}")
        text = path.read_text() if path.exists() else ""
        if text.count(BEGIN) != 1 or text.count(END) != 1 or expected not in text:
            errors.append(f"Routing missing/different: {path}")
    return {"ok": not errors, "errors": errors,
            "scope": "File bytes and entrypoints only; model behavior not verified"}


def package(source, output):
    data = payload(source)
    no_symlink(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    record = (json.dumps(manifest(data), indent=2) + "\n").encode()
    # Stable timestamps make unchanged sources produce identical archives.
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, body in (*data.items(), ("MANIFEST.json", record)):
            item = zipfile.ZipInfo(f"chat-ai/{name}", (2026, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item, body)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise ValueError("Archive verification failed")
    return {"archive": str(output), "size": output.stat().st_size,
            "sha256": digest(output.read_bytes()), "files": len(data) + 1}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("install", "check"):
        sub = commands.add_parser(command)
        sub.add_argument("--codex-home", type=Path, required=True)
        sub.add_argument("--vault-root", type=Path)
        sub.add_argument("--profile", type=Path,
                         help="Private Markdown settings; referenced, never packaged")
        if command == "install":
            sub.add_argument("--replace", action="store_true")
    export = commands.add_parser("package")
    export.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).absolute().parent.parent
    try:
        if args.command == "package":
            result = package(source, args.output.absolute())
        else:
            home = args.codex_home.expanduser().absolute()
            vault = args.vault_root.expanduser().absolute() if args.vault_root else None
            profile = args.profile.expanduser().absolute() if args.profile else None
            result = (install(source, home, vault, args.replace, profile)
                      if args.command == "install" else check(source, home, vault, profile))
        print(json.dumps(result, indent=2))
        return 1 if (result.get("ok") is False or
                     result.get("verification", {}).get("ok") is False) else 0
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
