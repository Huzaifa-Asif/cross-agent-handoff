"""Regression for regex contract; no jsonschema runtime dependency."""
import json
from pathlib import Path
import re
import unittest


class SchemaContractTests(unittest.TestCase):
    def test_path_newline_cannot_hide_traversal_or_drive(self):
        schema = json.loads((Path(__file__).resolve().parents[1] / 'docs/schema-v1.json').read_text())
        for field in ('files', 'artifacts'):
            pattern = schema['properties'][field]['items']['properties']['path']['pattern']
            for bad in ('a\n/../x', 'a\n:b', '../x', 'a\\b', '/x', 'a//b'):
                with self.subTest(field=field, path=bad):
                    self.assertIsNone(re.search(pattern, bad))
            self.assertIsNotNone(re.search(pattern, 'src/main.py'))

    def test_other_autoloaded_names_are_refused(self):
        import tempfile
        import handoff
        with tempfile.TemporaryDirectory() as tmp:
            for name in ('AGENTS.override.md', 'CLAUDE.local.md'):
                with self.subTest(name=name), self.assertRaises(handoff.HandoffError):
                    handoff.write_file(Path(tmp).resolve() / name, b'untrusted')

    def test_exact_schema_anchors_reject_trailing_newline(self):
        schema = json.loads((Path(__file__).resolve().parents[1] / 'docs/schema-v1.json').read_text())
        props = schema['properties']
        cases = [(props['id']['pattern'], 'demo'),
                 (props['parent_digest']['pattern'], 'a' * 64),
                 (props['repository']['properties']['commit']['anyOf'][0]['pattern'], 'a' * 40),
                 (props['artifacts']['items']['properties']['sha256']['anyOf'][0]['pattern'], 'a' * 64),
                 (props['created_at']['pattern'], '2026-10-30T00:00:00Z')]
        for pattern, value in cases:
            self.assertIsNotNone(re.search(pattern, value))
            self.assertIsNone(re.search(pattern, value + '\n'))

    def test_relative_outputs_from_reserved_working_directories(self):
        import os
        import tempfile
        import handoff
        old = Path.cwd()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            try:
                for directory in ('.cursor/rules', '.github', '.claude/nested', '.codex', '.gemini'):
                    dest = root / directory; dest.mkdir(parents=True, exist_ok=True)
                    os.chdir(dest)
                    with self.subTest(directory=directory), self.assertRaises(handoff.HandoffError):
                        handoff.write_file('handoff.mdc', b'untrusted')
                    self.assertFalse((dest / 'handoff.mdc').exists())
            finally:
                os.chdir(old)
