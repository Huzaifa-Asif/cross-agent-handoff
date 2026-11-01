"""Reject normalization/redaction budget growth before publishing any revision."""
from contextlib import contextmanager
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import handoff as h
import migration as m


def conversation(identifier, count=1, context=None):
    value = {'id': identifier, 'messages': [
        {'role': 'user', 'text': 'Synthetic context', 'timestamp': '2026-01-01T00:00:00Z',
         'attachments': [{'name': 'brief.txt', 'source': 'local-reference'}]}
        for _ in range(count)]}
    if context is not None:
        value['context'] = context
    return value


@contextmanager
def small_node_budget(limit=100):
    """Scale ordinary JSON/record limits, retaining the explicit aggregate limit."""
    original = m.validate_json_structure
    def validate(value, max_nodes=m.MAX_NODES):
        return original(value, limit if max_nodes == m.MAX_NODES else max_nodes)
    with patch.object(m, 'validate_json_structure', validate):
        yield


class NormalizedBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='handoff-normalized-budget-')
        self.root = Path(self.temp.name).resolve()
        self.source, self.workspace = self.root / 'selected.json', self.root / 'library'

    def tearDown(self):
        self.temp.cleanup()

    def plan(self, value):
        self.source.write_bytes(m.json_bytes(value))
        return m.plan(self.source, self.workspace, 'generic', 'generic-json')

    def files(self):
        return {path.name: path.read_bytes() for path in self.workspace.iterdir()}

    def test_real_source_depth_boundary_stays_reviewable_as_omission(self):
        value = 'Synthetic context'
        for _ in range(m.MAX_DEPTH):
            value = {'level': value}
        raw = m.json_bytes(value)
        self.assertEqual(m.bounded_json(raw), value)  # Valid at the real source limit.
        start = self.plan(value)
        events = []
        done = m.auto_run(self.workspace, start['checkpoint'], on_progress=events.append)
        self.assertEqual(done['phase'], 'complete-with-omissions')
        self.assertEqual(done['normalized_records'], 0)
        self.assertEqual(done['preserved_only_units'], 1)
        self.assertFalse(list(self.workspace.glob('record-*.json')))
        self.assertEqual((self.workspace / 'source.bin').read_bytes(), raw)
        review = m.review(self.workspace)
        self.assertEqual(review['omissions'][0]['after_record'], 0)
        self.assertIn('JSON structure exceeds limits', review['omissions'][0]['reason'])
        self.assertTrue(all(event['progress_percent'] != 100 for event in events))
        output = self.root / 'portable'
        m.export(self.workspace, done['checkpoint'], output, 'generic', include_source=True)
        self.assertEqual((output / 'original-export.bin').read_bytes(), raw)
        self.assertEqual(m.verify_export(output)['verified_files'], 1)

    def test_node_growth_rejected_before_record_and_cursor_publication(self):
        value = conversation('oversized-after-normalization', 4)
        with small_node_budget():
            self.assertEqual(m.bounded_json(m.json_bytes(value)), value)
            start = self.plan(value)
            done = m.auto_run(self.workspace, start['checkpoint'])
            self.assertEqual(done['normalized_records'], 0)
            self.assertEqual(done['preserved_only_units'], 1)
            checkpoint = json.loads((self.workspace / 'checkpoint.json').read_bytes())['data']
            self.assertEqual(checkpoint['records'], [])
            self.assertEqual(checkpoint['next_record'], 0)
            self.assertEqual(checkpoint['omissions'][0]['after_record'], 0)
            self.assertEqual(set(self.files()), {'source.bin', 'checkpoint.json', 'lock'})
            self.assertEqual(m.review(self.workspace)['checkpoint'], done['checkpoint'])
            self.assertEqual((self.workspace / 'source.bin').read_bytes(), self.source.read_bytes())

    def test_valid_prefix_resume_and_next_unit_preserve_exact_records(self):
        first, bad, following = conversation('first'), conversation('oversized', 4), conversation('following')
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('first.json', m.json_bytes([first, bad]))
            archive.writestr('following.json', m.json_bytes([following]))
        raw = stream.getvalue()
        self.source.write_bytes(raw)
        with small_node_budget():
            start = m.plan(self.source, self.workspace, 'generic', 'generic-json')
            prefix = m.run(self.workspace, start['checkpoint'], max_records=1)
            prefix_name = 'record-00000-00000.json'
            prefix_bytes = (self.workspace / prefix_name).read_bytes()
            self.assertEqual(prefix['next_record'], 1)
            done = m.auto_run(self.workspace, prefix['checkpoint'], max_units=1, max_records=1)
            self.assertEqual(done['normalized_records'], 2)
            self.assertEqual(done['partially_normalized_units'], 1)
            self.assertEqual(done['phase'], 'complete-with-omissions')
            self.assertEqual((self.workspace / prefix_name).read_bytes(), prefix_bytes)
            self.assertEqual((self.workspace / 'source.bin').read_bytes(), raw)
            names = {path.name for path in self.workspace.glob('record-*.json')}
            self.assertEqual(names, {prefix_name, 'record-00001-00000.json'})
            records = [m.show(self.workspace, name) for name in sorted(names)]
            self.assertEqual([record['id'] for record in records], ['first', 'following'])
            self.assertEqual(records[0]['messages'][0]['text'], first['messages'][0]['text'])
            review = m.review(self.workspace)
            self.assertEqual(review['omissions'][0]['after_record'], 1)
            self.assertEqual(review['omissions'][0]['member'], 'first.json')
            output = self.root / 'portable'
            m.export(self.workspace, done['checkpoint'], output, 'generic')
            self.assertEqual(m.verify_export(output)['verified_files'], 4)

    def test_redaction_metadata_overhead_rejection_changes_no_files(self):
        # Three messages plus eleven context items normalize to exactly100 nodes.
        # Redacting a scalar preserves its size in nodes, but the omission adds5.
        with small_node_budget():
            start = self.plan(conversation('at-reader-boundary', 3, ['inert'] * 11))
            done = m.auto_run(self.workspace, start['checkpoint'])
            name = m.review(self.workspace)['records'][0]['file']
            before = self.files()
            with self.assertRaisesRegex(h.HandoffError, 'JSON structure exceeds limits'):
                m.redact(self.workspace, done['checkpoint'], name, '/title')
            self.assertEqual(self.files(), before)
            self.assertFalse(list(self.workspace.glob('redacted-*.json')))
            after = m.review(self.workspace)
            self.assertEqual(after['checkpoint'], done['checkpoint'])
            self.assertEqual(after['redactions'], 0)

    def test_redaction_byte_overhead_rejection_changes_no_files(self):
        start = self.plan(conversation('byte-boundary'))
        done = m.auto_run(self.workspace, start['checkpoint'])
        name = m.review(self.workspace)['records'][0]['file']
        before = self.files()
        with patch.object(m, 'MAX_RECORD', len(before[name]) + 1):
            with self.assertRaisesRegex(h.HandoffError, 'normalized record exceeds'):
                m.redact(self.workspace, done['checkpoint'], name, '/title')
        self.assertEqual(self.files(), before)
        self.assertEqual(m.review(self.workspace)['checkpoint'], done['checkpoint'])

    def test_bounded_redaction_keeps_normal_revision_behavior(self):
        with small_node_budget():
            start = self.plan(conversation('ordinary'))
            done = m.auto_run(self.workspace, start['checkpoint'])
            name = m.review(self.workspace)['records'][0]['file']
            original = (self.workspace / name).read_bytes()
            redacted = m.redact(self.workspace, done['checkpoint'], name, '/messages/0/text')
            self.assertEqual(redacted['redactions'], 1)
            self.assertEqual(redacted['intentional_redactions'], 1)
            self.assertEqual((self.workspace / name).read_bytes(), original)
            new_name = m.review(self.workspace)['records'][0]['file']
            self.assertEqual(m.show(self.workspace, new_name)['messages'][0]['text'], '[REDACTED]')


if __name__ == '__main__':
    unittest.main()
