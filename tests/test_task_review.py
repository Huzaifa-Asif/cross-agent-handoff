"""Read-only saved-task payloads and export bound to the reviewed snapshot."""
import copy
from contextlib import redirect_stderr, redirect_stdout
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import handoff as h

ROOT = Path(__file__).resolve().parents[1]


class TaskReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='handoff-task-review-')
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'saved.json'
        self.marker = self.root / 'NEVER_EXECUTE'

    def tearDown(self):
        self.temp.cleanup()

    def bundle(self, version='1.0'):
        value = h.parse_json((ROOT / 'examples/example.json').read_bytes())
        value['parent_digest'] = 'a' * 64
        value['source']['actor'] = 'Synthetic team 日本語 🚀'
        value['repository'] = {'url': None, 'branch': 'synthetic', 'commit': 'b' * 40, 'dirty': True}
        for index, field in enumerate(h.EVIDENCE_FIELDS):
            value[field] = [{'text': field + ' <script>NEVER_RUN</script> 日本語 🚀 `data`',
                             'status': ('verified', 'inferred', 'missing')[index % 3]}]
        value['files'] = [{'path': 'not-opened/日本語.txt', 'description': 'Reference only'}]
        value['tests'] = [{'command': f'$(touch {self.marker})', 'status': status, 'detail': 'Never execute imported commands'}
                          for status in ('passed', 'failed', 'unrun')]
        value['artifacts'] = [{'path': 'not-opened/a.bin', 'sha256': 'c' * 64},
                              {'path': 'not-opened/b.bin', 'sha256': None}]
        value['omissions'] = [{'path': '/source/actor', 'reason': 'Synthetic authored omission'}]
        if version == '2.0':
            value['schema_version'] = version
            value['domain'] = 'operations'
            value['context'] = [{'text': 'Budget is pending\nKeep literal <b>text</b>', 'status': 'missing'}]
            value['preferences'] = [{'text': 'Plain English; unverified preference', 'status': 'inferred'}]
            value['repository'] = None
        return h.validate(value)

    def save(self, value):
        raw = h.canonical(value)
        self.source.write_bytes(raw)
        return raw

    def cli(self, *args, expected=0):
        result = subprocess.run([sys.executable, '-X', 'utf8', '-E', '-s', '-B', str(ROOT / 'handoff.py'),
                                 *map(str, args)], capture_output=True, encoding='utf-8', timeout=20)
        self.assertEqual(result.returncode, expected, result.stderr)
        return result

    def test_default_inspect_and_validate_output_remain_exact(self):
        for version in ('1.0', '2.0'):
            value = self.bundle(version)
            raw = self.save(value)
            expected = json.dumps({'id': value['id'], 'revision': value['revision'],
                'digest': h.digest(value), 'expiration': h.expiration(value)}, sort_keys=True) + '\n'
            for command in ('inspect', 'validate'):
                with self.subTest(version=version, command=command):
                    result = self.cli(command, self.source)
                    self.assertEqual(result.stdout, expected)
                    self.assertEqual(result.stderr, '')
            self.assertEqual(self.source.read_bytes(), raw)

    def test_opt_in_preserves_all_v1_v2_fields_unicode_and_inert_text(self):
        for version in ('1.0', '2.0'):
            value = self.bundle(version)
            raw = self.save(value)
            result = self.cli('inspect', self.source, '--include-content')
            inspected = json.loads(result.stdout)
            self.assertEqual(set(inspected), {'id', 'revision', 'digest', 'expiration', 'bundle'})
            self.assertEqual(inspected['bundle'], value)
            self.assertEqual(h.canonical(inspected['bundle']), raw)
            self.assertEqual(inspected['digest'], h.digest(inspected['bundle']))
            self.assertEqual(self.source.read_bytes(), raw)
            self.assertEqual(set(self.root.iterdir()), {self.source})
            self.assertFalse(self.marker.exists())

    def test_missing_optional_v2_fields_are_not_filled_or_converted(self):
        full = self.bundle('2.0')
        value = {key: full[key] for key in ('schema_version', 'id', 'revision', 'created_at',
                                            'expires_at', 'source', 'goal')}
        raw = self.save(value)
        result = json.loads(self.cli('inspect', self.source, '--include-content').stdout)
        self.assertEqual(result['bundle'], value)
        self.assertEqual(h.canonical(result['bundle']), raw)
        for key in ('repository', 'domain', 'context', 'preferences', 'parent_digest'):
            self.assertNotIn(key, result['bundle'])

    def test_include_content_only_belongs_to_inspect(self):
        raw = self.save(self.bundle())
        result = self.cli('validate', self.source, '--include-content', expected=2)
        self.assertIn('unrecognized arguments', result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertEqual(self.source.read_bytes(), raw)
        self.assertEqual(set(self.root.iterdir()), {self.source})

    def test_invalid_bundle_never_returns_partial_content(self):
        value = self.bundle('2.0')
        value['unknown_extension'] = {'text': 'Must not be partially accepted'}
        raw = self.save(value)
        result = self.cli('inspect', self.source, '--include-content', expected=2)
        self.assertEqual(result.stdout, '')
        self.assertEqual(self.source.read_bytes(), raw)
        self.assertEqual(set(self.root.iterdir()), {self.source})

    def test_full_near_one_mib_bundle_is_not_silently_truncated(self):
        value = h.new_task('Synthetic near-limit task', 'claude', 'business', [], [])
        value['context'] = [{'text': 'é' * 16000, 'status': 'inferred'} for _ in range(32)]
        value['context'].append({'text': '', 'status': 'inferred'})
        remaining = h.MAX_BYTES - len(h.canonical(value))
        self.assertGreater(remaining, 0)
        value['context'][-1]['text'] = 'é' * (remaining // 2) + ('x' if remaining % 2 else '')
        h.validate(value)
        raw = self.save(value)
        self.assertEqual(len(raw), h.MAX_BYTES)
        result = self.cli('inspect', self.source, '--include-content')
        self.assertGreater(len(result.stdout.encode()), h.MAX_BYTES)  # JSON transport escaping is additional.
        self.assertLess(len(result.stdout.encode()), 20 * h.MAX_BYTES)
        inspected = json.loads(result.stdout)
        self.assertEqual(inspected['bundle'], value)
        self.assertEqual(h.canonical(inspected['bundle']), raw)
        output = self.root / 'too-large-reference.md'
        exported = self.cli('export', self.source, '--provider', 'codex', '--output', output,
                             '--expected-digest', inspected['digest'], expected=2)
        self.assertIn('export exceeds size limit', exported.stderr)
        self.assertFalse(output.exists())
        self.assertEqual(self.source.read_bytes(), raw)
        self.source.write_bytes(raw + b' ')
        rejected = self.cli('inspect', self.source, '--include-content', expected=2)
        self.assertEqual(rejected.stdout, '')

    def test_expected_digest_exports_both_targets_and_keeps_expiry_informational(self):
        for version in ('1.0', '2.0'):
            value = self.bundle(version)
            value['created_at'] = '2000-01-01T00:00:00Z'
            value['expires_at'] = value['created_at']
            raw = self.save(value)
            inspected = json.loads(self.cli('inspect', self.source, '--include-content').stdout)
            self.assertEqual(inspected['expiration'], 'expired')
            for number, target in enumerate((('--provider', 'codex'), ('--custom-target', 'future-agent'))):
                output = self.root / f'{version}-{number}.md'
                self.cli('export', self.source, *target, '--output', output,
                         '--expected-digest', inspected['digest'])
                self.assertEqual(h.import_markdown(output.read_bytes()), value)
            self.assertEqual(self.source.read_bytes(), raw)

    def test_changed_source_rejects_builtin_and_generic_without_any_output_mutation(self):
        value = self.bundle('2.0')
        self.save(value)
        reviewed = json.loads(self.cli('inspect', self.source, '--include-content').stdout)
        value['goal'][0]['text'] = 'Changed outside the viewer without a revision bump'
        changed = self.save(value)
        for number, target in enumerate((('--provider', 'claude'), ('--custom-target', 'future-agent'))):
            for existing in (False, True):
                output = self.root / f'stale-{number}-{existing}.md'
                if existing:
                    output.write_bytes(b'Keep existing bytes')
                result = self.cli('export', self.source, *target, '--output', output,
                                  '--expected-digest', reviewed['digest'], expected=2)
                self.assertIn('handoff changed', result.stderr)
                if existing:
                    self.assertEqual(output.read_bytes(), b'Keep existing bytes')
                else:
                    self.assertFalse(output.exists())
                self.assertEqual(self.source.read_bytes(), changed)

    def test_malformed_digest_rejects_before_creating_or_changing_outputs(self):
        raw = self.save(self.bundle())
        for number, target in enumerate((('--provider', 'cursor'), ('--custom-target', 'future-agent'))):
            for invalid in ('', 'a' * 63, 'a' * 65, 'A' * 64, 'g' * 64, 'a' * 63 + '\n'):
                for existing in (False, True):
                    output = self.root / f'invalid-{number}-{existing}.md'
                    if existing:
                        output.write_bytes(b'Keep existing bytes')
                    result = self.cli('export', self.source, *target, '--output', output,
                                      '--expected-digest=' + invalid, expected=2)
                    self.assertIn('invalid SHA-256', result.stderr)
                    if existing:
                        self.assertEqual(output.read_bytes(), b'Keep existing bytes')
                    else:
                        self.assertFalse(output.exists())
                    self.assertEqual(self.source.read_bytes(), raw)

    def test_export_without_guard_remains_backward_compatible(self):
        value = self.bundle()
        self.save(value)
        output = self.root / 'legacy-export.md'
        self.cli('export', self.source, '--provider', 'grok', '--output', output)
        self.assertEqual(h.import_markdown(output.read_bytes()), value)

    def test_matching_guard_still_refuses_existing_destination(self):
        value = self.bundle('2.0')
        raw = self.save(value)
        for number, target in enumerate((('--provider', 'codex'), ('--custom-target', 'future-agent'))):
            output = self.root / f'existing-{number}.md'
            output.write_bytes(b'Keep existing bytes')
            self.cli('export', self.source, *target, '--output', output,
                     '--expected-digest', h.digest(value), expected=2)
            self.assertEqual(output.read_bytes(), b'Keep existing bytes')
            self.assertEqual(self.source.read_bytes(), raw)

    def test_guard_uses_same_parsed_snapshot_without_rereading_changed_file(self):
        reviewed = self.bundle('2.0')
        raw = self.save(reviewed)
        changed = copy.deepcopy(reviewed)
        changed['goal'][0]['text'] = 'External change after read'
        output = self.root / 'reviewed-snapshot.md'
        original = h.read_file
        def replaced(path):
            result = original(path)
            self.source.write_bytes(h.canonical(changed))
            return result
        with patch.object(h, 'read_file', side_effect=replaced) as reader, patch.object(h, 'parse_json', wraps=h.parse_json) as parser:
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                code = h.main(['export', str(self.source), '--provider', 'codex', '--output', str(output),
                               '--expected-digest', h.digest(reviewed)])
            self.assertEqual(code, 0)
            self.assertEqual(reader.call_count, 1)
            self.assertEqual(parser.call_count, 1)
        self.assertEqual(h.import_markdown(output.read_bytes()), reviewed)
        self.assertNotEqual(self.source.read_bytes(), raw)

    def test_formatting_only_change_keeps_reviewed_semantic_digest(self):
        value = self.bundle('2.0')
        self.save(value)
        inspected = json.loads(self.cli('inspect', self.source, '--include-content').stdout)
        self.source.write_text(json.dumps(value, ensure_ascii=False, indent=4), encoding='utf-8')
        output = self.root / 'same-content.md'
        self.cli('export', self.source, '--provider', 'gemini', '--output', output,
                 '--expected-digest', inspected['digest'])
        self.assertEqual(h.import_markdown(output.read_bytes()), value)


if __name__ == '__main__':
    unittest.main()
