import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("manage", SOURCE / "scripts/manage.py")
manage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manage)


class ManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.home = self.root / "home"
        self.vault = self.root / "vault"
        self.home.mkdir()
        self.vault.mkdir()
        self.rules = self.home / "AGENTS.md"
        self.rules.write_text("# Existing rules\n\nDo not change these.\n")

    def install(self, **kwargs):
        return manage.install(SOURCE, self.home, self.vault, **kwargs)

    def test_install_checks_and_preserves_existing_rules(self):
        original = self.rules.read_bytes()
        result = self.install()
        self.assertTrue(result["verification"]["ok"])
        self.assertTrue(self.rules.read_bytes().startswith(original))
        backup = Path(result["backup"])
        mapping = json.loads((backup / "restore-map.json").read_text())
        saved = next(backup / name for name, path in mapping.items() if path == str(self.rules))
        self.assertEqual(saved.read_bytes(), original)

    def test_second_install_has_no_writes(self):
        self.install()
        result = self.install()
        self.assertEqual(result["changed"], [])
        self.assertIsNone(result["backup"])
        self.assertEqual(self.rules.read_text().count(manage.BEGIN), 1)

    def test_preserves_edits_outside_managed_block(self):
        self.install()
        self.rules.write_text(self.rules.read_text() + "\n# Later user rule\nKeep me.\n")
        self.install()
        self.assertTrue(self.rules.read_text().endswith("Keep me.\n"))

    def test_local_skill_edit_stops_all_mutations(self):
        self.install()
        skill = self.home / "skills/chat-ai/SKILL.md"
        skill.write_text("User edited this")
        self.rules.write_text("New unrelated instructions")
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual(self.rules.read_text(), "New unrelated instructions")
        self.assertEqual(skill.read_text(), "User edited this")

    def test_explicit_replace_backs_up_edit(self):
        self.install()
        skill = self.home / "skills/chat-ai/SKILL.md"
        skill.write_text("User edit to preserve")
        result = self.install(replace=True)
        backup = Path(result["backup"])
        self.assertTrue(any(p.read_text() == "User edit to preserve"
                            for p in backup.iterdir() if p.name.endswith("SKILL.md")))

    def test_malformed_markers_stop_before_skill_install(self):
        self.rules.write_text(manage.BEGIN + "\nBroken")
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse((self.home / "skills").exists())

    def test_check_detects_missing_rule_and_modified_file(self):
        self.install()
        self.rules.write_text("Other rules")
        (self.home / "skills/chat-ai/SKILL.md").write_text("Changed")
        result = manage.check(SOURCE, self.home, self.vault)
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["errors"]), 2)

    def test_symlink_rule_is_rejected(self):
        self.rules.unlink()
        target = self.root / "other-rules"
        target.write_text("Do not modify")
        self.rules.symlink_to(target)
        with self.assertRaises(ValueError):
            self.install()
        self.assertEqual(target.read_text(), "Do not modify")

    def test_package_is_allowlisted_and_hash_verified(self):
        output = self.root / "skill.zip"
        result = manage.package(SOURCE, output)
        self.assertEqual(result["sha256"], hashlib.sha256(output.read_bytes()).hexdigest())
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(set(archive.namelist()),
                             {"chat-ai/" + n for n in (*manage.FILES, "MANIFEST.json")})
            manifest = json.loads(archive.read("chat-ai/MANIFEST.json"))
            for name, expected in manifest["sha256"].items():
                self.assertEqual(hashlib.sha256(archive.read("chat-ai/" + name)).hexdigest(), expected)

    def test_package_refuses_overwrite_and_is_reproducible(self):
        first, second = self.root / "one.zip", self.root / "two.zip"
        manage.package(SOURCE, first)
        with self.assertRaises(FileExistsError):
            manage.package(SOURCE, first)
        manage.package(SOURCE, second)
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_unknown_private_files_are_excluded(self):
        source = self.root / "source"
        for name, body in manage.payload(SOURCE).items():
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
        (source / "private-note.md").write_text("Must not export")
        output = self.root / "export.zip"
        manage.package(source, output)
        with zipfile.ZipFile(output) as archive:
            self.assertNotIn("chat-ai/private-note.md", archive.namelist())

    def test_local_profile_is_referenced_not_copied(self):
        profile = self.vault / "private-profile.md"
        profile.write_text("Private context, not portable package content")
        result = self.install(profile=profile)
        self.assertTrue(result["verification"]["ok"])
        self.assertIn(str(profile), self.rules.read_text())
        self.assertFalse((self.home / "skills/chat-ai/private-profile.md").exists())
        profile.unlink()
        self.assertFalse(manage.check(SOURCE, self.home, self.vault, profile)["ok"])

    def test_missing_profile_fails_before_install(self):
        with self.assertRaises(ValueError):
            self.install(profile=self.vault / "missing.md")
        self.assertFalse((self.home / "skills").exists())

    def test_active_override_fails_before_install(self):
        (self.home / "AGENTS.override.md").write_text("Different policy")
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse((self.home / "skills").exists())

    def test_added_override_is_detected(self):
        self.install()
        (self.vault / "AGENTS.override.md").write_text("Different policy")
        self.assertFalse(manage.check(SOURCE, self.home, self.vault)["ok"])


if __name__ == "__main__":
    unittest.main()
