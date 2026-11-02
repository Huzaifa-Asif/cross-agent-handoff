"""Synthetic Windows engine integration; native skips are not support evidence."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import unittest

import handoff as h
import migration as m

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == 'nt', 'Requires actual Windows filesystem/runtime')
class WindowsJourneys(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='handoff-windows-')
        self.root = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def cli(self, *args, expected=0):
        result = subprocess.run([sys.executable, '-X', 'utf8', '-E', '-s', '-B',
                                 str(ROOT / 'handoff.py'), *map(str, args)],
                                capture_output=True, encoding='utf-8', timeout=30)
        self.assertEqual(result.returncode, expected, result.stderr)
        return result

    def test_business_developer_and_legacy_task_roundtrips(self):
        self.assertTrue(h.safe_io_available())
        task = self.root / 'task 日本語.json'
        self.cli('new', '--goal', 'Campaign 日本語 🚀', '--provider', 'claude',
                 '--domain', 'marketing', '--context', 'Budget pending', '--output', task)
        value = h.parse_json(h.read_file(task))
        self.assertNotIn('repository', value)
        for provider in h.PROVIDERS:
            out = self.root / (provider + '-handoff.md')
            self.cli('export', task, '--provider', provider, '--output', out)
            self.assertEqual(h.import_markdown(h.read_file(out)), value)
        legacy = h.parse_json(h.read_file(ROOT / 'examples/example.json'))
        self.assertEqual(h.import_markdown(h.export_markdown(legacy, 'codex')), legacy)
        self.cli('new', '--goal', 'Refuse overwrite', '--provider', 'codex', '--output', task, expected=2)
        self.assertEqual(h.parse_json(h.read_file(task)), value)
        self.cli('purge', task, '--confirm')
        self.assertFalse(task.exists())

    def test_resumed_history_reports_redaction_and_verified_export(self):
        source = self.root / 'history 日本語.json'
        values = [{'id': str(i), 'messages': [{'role': 'user', 'text': 'Plan 日本語 🚀 ' + str(i),
                   'timestamp': '2026-01-01T00:00:00Z', 'branch': {'parent': 'earlier'}}]}
                  for i in range(125)]
        source.write_text(json.dumps(values, ensure_ascii=False), encoding='utf-8')
        workspace = self.root / 'library'
        start = m.plan(source, workspace, 'generic', 'generic-json')
        first = m.run(workspace, start['checkpoint'], max_records=25)
        self.assertFalse(first['complete'])
        with self.assertRaises(h.HandoffError):
            m.run(workspace, start['checkpoint'])
        events = []
        done = m.auto_run(workspace, first['checkpoint'], max_records=25, on_progress=events.append)
        self.assertEqual(done['normalized_records'], 125)
        self.assertEqual(done['record_omissions'], 125)
        self.assertTrue(all(e['progress_percent'] != 100 for e in events))
        checkpoint = json.loads((workspace / 'checkpoint.json').read_text())['data']
        records = [json.loads((workspace / item['file']).read_bytes()) for item in checkpoint['records']]
        self.assertEqual([r['messages'][0]['text'] for r in records], [v['messages'][0]['text'] for v in values])
        name = checkpoint['records'][0]['file']
        redacted = m.redact(workspace, done['checkpoint'], name, '/messages/0/text')
        self.assertEqual(redacted['intentional_redactions'], 1)
        with self.assertRaises(h.HandoffError):
            m.export(workspace, redacted['checkpoint'], self.root / 'raw-forbidden', 'generic', True)
        out = self.root / 'portable'
        m.export(workspace, redacted['checkpoint'], out, 'generic')
        self.assertEqual(m.verify_export(out)['verified_files'], 250)
        self.assertFalse((out / 'original-export.bin').exists())
        self.assertTrue(m.purge(workspace)['removed'])

    def test_cooperative_pause_uses_durable_stdout_and_unicode_pipes(self):
        source = self.root / 'history.json'
        source.write_text(json.dumps([{'id': str(i), 'messages': [{'role': 'user',
                          'timestamp': '2026-01-01T00:00:00Z', 'text': '日本語 🚀 ' + str(i)}]}
                          for i in range(200)]), encoding='utf-8')
        workspace = self.root / 'paused'
        plan = m.plan(source, workspace, 'generic', 'generic-json')
        env = dict(os.environ, HANDOFF_CANCEL_STDIN='1')
        args = [sys.executable, '-X', 'utf8', '-E', '-s', '-B', str(ROOT / 'handoff.py'),
                'migrate', 'run', '--workspace', str(workspace), '--base-digest', plan['checkpoint'], '--max-records', '10']
        job = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=env)
        milestone, prefix = queue.Queue(), []
        def wait_for_checkpoint():
            size = 0
            try:
                for line in job.stderr:
                    size += len(line)
                    if size > 128 * 1024:
                        milestone.put(False)
                        return
                    prefix.append(line)
                    try:
                        event = json.loads(line)
                    except (ValueError, UnicodeError):
                        continue
                    if event.get('phase') == 'batch-complete':
                        milestone.put(True)
                        return
                milestone.put(False)
            except (OSError, ValueError):
                milestone.put(False)
        reader = threading.Thread(target=wait_for_checkpoint, daemon=True)
        reader.start()
        try:
            try:
                reached = milestone.get(timeout=20)
            except queue.Empty:
                self.fail('No batch checkpoint before the bounded pause deadline')
            self.assertTrue(reached, b''.join(prefix).decode('utf-8', errors='replace'))
            reader.join(timeout=2)
            self.assertFalse(reader.is_alive(), 'Checkpoint reader did not finish')
            # Match the desktop's exact byte protocol without Windows text-mode
            # newline translation. communicate owns both readers from here on.
            stdout, remaining = job.communicate(input=b'pause\n', timeout=30)
            stderr = (b''.join(prefix) + remaining).decode('utf-8', errors='replace')
        finally:
            if job.poll() is None:
                job.kill()  # Only this test's own child.
                job.wait(timeout=5)
            reader.join(timeout=5)
            for pipe in (job.stdin, job.stdout, job.stderr):
                if not pipe.closed:
                    pipe.close()
        self.assertEqual(job.returncode, 130, stderr)
        paused = json.loads(stdout)
        self.assertTrue(paused['paused'])
        self.assertEqual(m.review(workspace)['checkpoint'], paused['checkpoint'])
        done = m.auto_run(workspace, paused['checkpoint'])
        self.assertEqual(done['normalized_records'], 200)
        self.assertEqual(done['phase'], 'complete')
        checkpoint = json.loads((workspace / 'checkpoint.json').read_bytes())['data']
        records = [json.loads((workspace / item['file']).read_bytes()) for item in checkpoint['records']]
        self.assertEqual([record['id'] for record in records], [str(i) for i in range(200)])
        self.assertEqual([record['messages'][0]['text'] for record in records],
                         ['日本語 🚀 ' + str(i) for i in range(200)])


if __name__ == '__main__':
    unittest.main()
