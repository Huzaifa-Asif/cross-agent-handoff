"""Synthetic expiry boundaries for migration redaction and read-only recovery."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import migration as m


ROOT = Path(__file__).resolve().parents[1]


class RedactionRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='handoff-redaction-retention-')
        self.root = Path(self.temp.name).resolve()
        self.source, self.workspace = self.root / 'selected.json', self.root / 'library'
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.deadline = self.now + timedelta(hours=1)
        self.clock = [self.now]
        clock = self.clock
        class Clock:
            @staticmethod
            def now(tz=None):
                return clock[0] if tz is not None else clock[0].replace(tzinfo=None)
        self.Clock = Clock
        self.source.write_text(json.dumps({'id': 'synthetic', 'title': 'Synthetic title',
            'messages': [{'role': 'user', 'text': 'Synthetic context', 'timestamp': '2026-01-01T00:00:00Z'}]}), encoding='utf-8')
        start = m.plan(self.source, self.workspace, 'generic', 'generic-json',
                       self.deadline.isoformat().replace('+00:00', 'Z'))
        self.done = m.auto_run(self.workspace, start['checkpoint'])
        self.name = m.review(self.workspace)['records'][0]['file']

    def tearDown(self):
        self.temp.cleanup()

    def files(self):
        return {path.name: path.read_bytes() for path in self.workspace.iterdir()}

    def expire(self):
        self.clock[0] = self.deadline + timedelta(seconds=1)

    def assert_unchanged(self, before):
        self.assertEqual(self.files(), before)
        self.assertFalse(list(self.workspace.glob('redacted-*.json')))

    def test_initially_expired_redaction_leaves_all_files_unchanged(self):
        before = self.files()
        self.expire()
        with patch.object(m, 'datetime', self.Clock):
            with self.assertRaises(m.RetentionExpired):
                m.redact(self.workspace, self.done['checkpoint'], self.name, '/title')
            self.assert_unchanged(before)

    def test_expiry_during_verification_leaves_all_files_unchanged(self):
        before, original = self.files(), m.check_snapshot
        def verified(*args, **kwargs):
            result = original(*args, **kwargs)
            self.expire()
            return result
        with patch.object(m, 'datetime', self.Clock), patch.object(m, 'check_snapshot', verified):
            with self.assertRaises(m.RetentionExpired):
                m.redact(self.workspace, self.done['checkpoint'], self.name, '/title')
            self.assert_unchanged(before)

    def test_expiry_during_serialization_leaves_all_files_unchanged(self):
        before, original = self.files(), m.json_bytes
        def serialized(value):
            result = original(value)
            if value.get('record_schema_version') == '1.0':
                self.expire()
            return result
        with patch.object(m, 'datetime', self.Clock), patch.object(m, 'json_bytes', serialized):
            with self.assertRaises(m.RetentionExpired):
                m.redact(self.workspace, self.done['checkpoint'], self.name, '/title')
            self.assert_unchanged(before)

    def test_expired_read_only_review_show_search_and_explicit_purge(self):
        before = self.files()
        self.expire()
        with patch.object(m, 'datetime', self.Clock):
            self.assertTrue(m.review(self.workspace)['expired'])
            self.assertEqual(m.show(self.workspace, self.name)['title'], 'Synthetic title')
            self.assertEqual(m.search(self.workspace, 'Synthetic')['matched_records'], 1)
            self.assertEqual(self.files(), before)
            self.assertTrue(m.purge(self.workspace)['removed'])
        self.assertFalse(self.workspace.exists())
        self.assertEqual(self.source.read_bytes(), before['source.bin'])

    def test_active_redaction_keeps_normal_revision_behavior(self):
        before = self.files()
        with patch.object(m, 'datetime', self.Clock):
            result = m.redact(self.workspace, self.done['checkpoint'], self.name, '/title')
            review = m.review(self.workspace)
            self.assertFalse(review['expired'])
            self.assertEqual(result['redactions'], 1)
            self.assertEqual(result['intentional_redactions'], 1)
            self.assertNotEqual(result['checkpoint'], self.done['checkpoint'])
            self.assertEqual(m.show(self.workspace, review['records'][0]['file'])['title'], '[REDACTED]')
        self.assertEqual((self.workspace / self.name).read_bytes(), before[self.name])
        self.assertEqual((self.workspace / 'source.bin').read_bytes(), before['source.bin'])

    def test_expiry_after_authorized_publication_does_not_orphan_revision(self):
        original = m.Store.write
        def published(store, name, data, replace=False):
            result = original(store, name, data, replace=replace)
            if name.startswith('redacted-'):
                self.expire()
            return result
        with patch.object(m, 'datetime', self.Clock), patch.object(m.Store, 'write', published):
            result = m.redact(self.workspace, self.done['checkpoint'], self.name, '/title')
            review = m.review(self.workspace)
            self.assertTrue(review['expired'])
            self.assertEqual(review['checkpoint'], result['checkpoint'])
            self.assertEqual(review['redactions'], 1)
            self.assertEqual({path.name for path in self.workspace.glob('redacted-*.json')},
                             {review['records'][0]['file']})

    def test_expired_cli_redaction_is_checked_failure_with_unchanged_files(self):
        store = m.Store(self.workspace)
        try:
            data, digest = store.checkpoint()
            data['expires_at'] = '2000-01-01T00:00:00Z'
            digest = store.save(data, digest)
        finally:
            store.close()
        before = self.files()
        result = subprocess.run([sys.executable, '-X', 'utf8', '-E', '-s', '-B', str(ROOT / 'handoff.py'),
            'migrate', 'redact', '--workspace', str(self.workspace), '--base-digest', digest,
            '--record', self.name, '--pointer', '/title'], capture_output=True, text=True,
            encoding='utf-8', timeout=15)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('migration expired', result.stderr)
        self.assertEqual(result.stdout, '')
        self.assert_unchanged(before)


if __name__ == '__main__':
    unittest.main()
