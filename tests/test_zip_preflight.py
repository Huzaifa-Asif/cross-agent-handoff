"""Synthetic ZIP metadata budgets and cancellation; no provider/private fixtures."""
import hashlib
import errno
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import handoff as h
import migration as m


def archive_bytes(count=1, comment=b'', zip64=False, prefix=b''):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.comment = comment
        for index in range(count):
            archive.writestr(f'{index:08d}.txt', 'Synthetic context 日本語')
    raw = stream.getvalue()
    if zip64:
        end = len(raw) - 22 - len(comment)
        fields = struct.unpack_from('<4s4H2IH', raw, end)
        footer = struct.pack('<4sQ2H2I4Q', b'PK\x06\x06', 44, 45, 45, 0, 0,
                             count, count, fields[5], fields[6])
        locator = struct.pack('<4sIQI', b'PK\x06\x07', 0, end, 1)
        end_record = struct.pack('<4s4H2IH', b'PK\x05\x06', 0, 0, 65535, 65535,
                                 0xFFFFFFFF, 0xFFFFFFFF, len(comment))
        raw = raw[:end] + footer + locator + end_record + comment
    return prefix + raw


class ZipPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='handoff-zip-preflight-')
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'selected.zip'
        self.workspace = self.root / 'library'

    def tearDown(self):
        self.temp.cleanup()

    def reject_before_allocation(self, raw):
        self.source.write_bytes(raw)
        before = hashlib.sha256(raw).hexdigest()
        with patch.object(zipfile, 'ZipInfo', side_effect=AssertionError('Unbounded ZIP allocation')) as constructor:
            with self.assertRaises(h.HandoffError):
                m.plan(self.source, self.workspace, 'generic', 'documents')
            constructor.assert_not_called()
        self.assertFalse(self.workspace.exists())
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), before)

    def test_excess_members_rejected_before_zipinfo_instantiation(self):
        self.reject_before_allocation(archive_bytes(m.MAX_MEMBERS + 1))

    def test_exact_member_limit_remains_supported(self):
        self.assertEqual(len(m.zip_units(io.BytesIO(archive_bytes(m.MAX_MEMBERS)))), m.MAX_MEMBERS)

    def test_forged_small_count_cannot_bypass_actual_entry_limit(self):
        raw = bytearray(archive_bytes(m.MAX_MEMBERS + 1))
        struct.pack_into('<HH', raw, len(raw) - 22 + 8, 1, 1)
        self.reject_before_allocation(raw)

    def test_honest_and_forged_zip64_excess_counts(self):
        raw = bytearray(archive_bytes(m.MAX_MEMBERS + 1, zip64=True))
        self.reject_before_allocation(raw)
        footer = len(raw) - 22 - 20 - 56
        struct.pack_into('<QQ', raw, footer + 24, 1, 1)
        self.reject_before_allocation(raw)

    def test_directory_byte_budget_before_allocation(self):
        raw = archive_bytes(3)
        with patch.object(m, 'MAX_ZIP_DIRECTORY', 128):
            self.reject_before_allocation(raw)
        forged = bytearray(raw)
        struct.pack_into('<I', forged, len(forged) - 22 + 12, m.MAX_ZIP_DIRECTORY + 1)
        self.reject_before_allocation(forged)

    def test_count_range_and_variable_metadata_truncation(self):
        original = archive_bytes(2)
        central = original.index(b'PK\x01\x02')
        for offset, fmt, value in ((28, '<H', 4096), (30, '<H', 65535),
                                    (32, '<H', 65535), (28, '<H', 4098), (6, '<H', 64)):
            raw = bytearray(original)
            struct.pack_into(fmt, raw, central + offset, value)
            with self.subTest(offset=offset, value=value):
                self.reject_before_allocation(raw)
        for offset, fmt, value in ((8, '<H', 1), (12, '<I', 2),
                                    (16, '<I', len(original) + 1), (4, '<H', 1)):
            raw = bytearray(original)
            struct.pack_into(fmt, raw, len(raw) - 22 + offset, value)
            with self.subTest(end_offset=offset):
                self.reject_before_allocation(raw)

    def test_zip64_bad_locator_and_extensions_are_explicitly_rejected(self):
        original = archive_bytes(zip64=True)
        for offset, fmt, value in ((4, '<I', 1), (8, '<Q', len(original) + 1), (16, '<I', 2)):
            raw = bytearray(original)
            struct.pack_into(fmt, raw, len(raw) - 22 - 20 + offset, value)
            with self.subTest(locator_offset=offset):
                # is_zipfile itself may reject invalid locator metadata; exercise
                # the preflight directly to prove its own guard has no allocation.
                with patch.object(zipfile, 'ZipInfo') as constructor:
                    with self.assertRaises(h.HandoffError):
                        m.zip_units(io.BytesIO(raw))
                    constructor.assert_not_called()
        footer = len(original) - 22 - 20 - 56
        raw = bytearray(original)
        struct.pack_into('<Q', raw, footer + 4, 48)
        raw[footer + 56:footer + 56] = b'extr'
        self.reject_before_allocation(raw)

    def test_normal_empty_comment_prefix_and_zip64_archives(self):
        for count, comment, zip64, prefix in ((0, b'', False, b''),
                (2, b'Archive comment', False, b''), (1, b'x' * 65535, False, b''),
                (2, b'', False, b'Inert preamble\x00'), (2, b'', True, b''),
                (2, b'Comment', True, b'Inert preamble\x00')):
            with self.subTest(count=count, zip64=zip64, prefix=prefix, comment_bytes=len(comment)):
                raw = archive_bytes(count, comment, zip64, prefix)
                stream = io.BytesIO(raw)
                stream.seek(3)
                self.assertEqual(m.zip_preflight(stream), count)
                self.assertEqual(stream.tell(), 3)
                self.assertEqual(len(m.zip_units(stream)), count)
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    self.assertEqual(len(archive.infolist()), count)
                    if count:
                        self.assertEqual(archive.read('00000000.txt').decode(), 'Synthetic context 日本語')

    def test_local_zip64_extra_and_data_descriptors_remain_supported(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            with archive.open('context.txt', 'w', force_zip64=True) as output:
                output.write(b'local ZIP64 extra')
        self.assertEqual(m.zip_units(io.BytesIO(stream.getvalue()))[0]['bytes'], 17)
        class Nonseekable(io.BytesIO):
            def seekable(self):
                return False
            def seek(self, *args):
                raise io.UnsupportedOperation('synthetic nonseekable writer')
        stream = Nonseekable()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('context.txt', b'streamed')
        self.assertEqual(m.zip_units(io.BytesIO(stream.getvalue()))[0]['bytes'], 8)

    def test_existing_long_unicode_directory_limit_remains_supported(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('🚀' * 1024 + '/', b'')
        self.assertEqual(m.zip_preflight(io.BytesIO(stream.getvalue())), 1)
        self.assertEqual(m.zip_units(io.BytesIO(stream.getvalue())), [])

    def test_preflight_only_uses_bounded_reads(self):
        class TrackingReader(io.BytesIO):
            def read(self, size=-1):
                self.test.assertGreaterEqual(size, 0)
                self.test.assertLessEqual(size, max(m.MAX_ZIP_DIRECTORY, 65535 + 22))
                return super().read(size)
        stream = TrackingReader(archive_bytes(100))
        stream.test = self
        self.assertEqual(m.zip_preflight(stream), 100)

    def test_pause_during_preflight_before_allocation_and_workspace(self):
        raw = archive_bytes(10)
        calls = [0]
        def paused():
            calls[0] += 1
            return calls[0] == 4
        with patch.object(zipfile, 'ZipInfo') as constructor:
            with self.assertRaises(m.OperationPaused):
                m.zip_units(io.BytesIO(raw), paused)
            constructor.assert_not_called()
        self.source.write_bytes(raw)
        original = m._zip_view
        entered = [False]
        def preflight(*args, **kwargs):
            entered[0] = True
            return original(*args, **kwargs)
        with patch.object(m, '_zip_view', preflight), patch.object(zipfile, 'ZipInfo') as constructor:
            with self.assertRaises(m.SnapshotCancelled):
                m.plan(self.source, self.workspace, 'generic', 'documents', should_pause=lambda: entered[0])
            constructor.assert_not_called()
        self.assertFalse(self.workspace.exists())
        self.assertEqual(self.source.read_bytes(), raw)

    def test_mutation_after_preflight_cannot_expand_stdlib_metadata(self):
        stream = io.BytesIO(archive_bytes())
        view = m._zip_view(stream)
        stream.seek(0)
        stream.write(archive_bytes(m.MAX_MEMBERS + 1))
        calls = []
        class CountingInfo(zipfile.ZipInfo):
            def __init__(self, *args, **kwargs):
                calls.append(True)
                super().__init__(*args, **kwargs)
        with patch.object(zipfile, 'ZipInfo', CountingInfo):
            with zipfile.ZipFile(view) as archive:
                self.assertEqual(len(archive.infolist()), 1)
                self.assertEqual(archive.read('00000000.txt').decode(), 'Synthetic context 日本語')
            self.assertEqual(len(calls), 1)

    def test_scan_checks_the_cached_bytes_not_earlier_mutable_bytes(self):
        raw = archive_bytes(2)
        start = raw.index(b'PK\x01\x02')
        class ChangedCentral(io.BytesIO):
            def read(self, size=-1):
                if self.tell() == start:
                    changed = bytearray(super().read(size))
                    struct.pack_into('<H', changed, 28, 65535)
                    return bytes(changed)
                return super().read(size)
        with patch.object(zipfile, 'ZipInfo') as constructor:
            with self.assertRaises(h.HandoffError):
                m.zip_units(ChangedCentral(raw))
            constructor.assert_not_called()

    def test_metadata_view_matches_original_reads_and_clamps_growth(self):
        raw = archive_bytes(2, b'comment', True, b'preamble')
        source = io.BytesIO(raw)
        view = m._zip_view(source)
        for start, count in ((0, 12), (view.start - 2, 5), (view.start, 100),
                             (view.start + len(view.central) - 2, 5), (len(raw) - 3, 20)):
            view.seek(start)
            self.assertEqual(view.read(count), raw[start:start + count])
        source.seek(0, 2)
        source.write(b'unapproved growth')
        view.seek(0, 2)
        self.assertEqual(view.read(), b'')
        view.seek(-10, 2)
        self.assertEqual(view.read(), raw[-10:])

    def test_empty_zip_negative_seek_matches_os_file_contract(self):
        raw = archive_bytes(0)
        self.assertEqual(len(raw), 22)
        view = m._zip_view(io.BytesIO(raw))
        for offset, whence in ((-1, 0), (-1, 1), (-42, 2)):
            with self.subTest(offset=offset, whence=whence):
                with self.assertRaises(OSError) as caught:
                    view.seek(offset, whence)
                self.assertEqual(caught.exception.errno, errno.EINVAL)
                self.assertEqual(view.tell(), 0)
        with zipfile.ZipFile(view) as archive:
            self.assertEqual(archive.infolist(), [])

    def test_pause_during_hashing_leaves_source_and_no_workspace(self):
        self.source.write_bytes(b'A' * (2 * 1024 * 1024))
        calls = [0]
        def paused():
            calls[0] += 1
            return calls[0] == 2
        with self.assertRaises(m.SnapshotCancelled):
            m.plan(self.source, self.workspace, 'generic', 'archive', should_pause=paused)
        self.assertEqual(calls[0], 2)
        self.assertFalse(self.workspace.exists())
        self.assertEqual(self.source.stat().st_size, 2 * 1024 * 1024)

    def test_run_hash_pause_never_claims_complete_or_unknown_findings(self):
        self.source.write_text(json.dumps([{'id': 'a', 'messages': [
            {'role': 'user', 'text': 'inert', 'timestamp': '2026-01-01T00:00:00Z'}]}]))
        plan = m.plan(self.source, self.workspace, 'generic', 'generic-json')
        done = m.auto_run(self.workspace, plan['checkpoint'])
        events = []
        paused = m.auto_run(self.workspace, done['checkpoint'], should_pause=lambda: True, on_progress=events.append)
        self.assertTrue(paused['paused'])
        self.assertFalse(paused['complete'])
        self.assertTrue(paused['verification_pending'])
        self.assertEqual(paused['checkpoint'], done['checkpoint'])
        for key in m.FINDING_COUNTS:
            self.assertNotIn(key, paused)
        self.assertTrue(all(event['progress_percent'] != 100 for event in events))
        self.assertTrue(events[-1]['verification_pending'])
        self.assertTrue(all(key not in events[-1] for key in m.FINDING_COUNTS))
        resumed = m.auto_run(self.workspace, paused['checkpoint'])
        self.assertTrue(resumed['complete'])
        self.assertEqual(resumed['normalized_records'], 1)

    def test_pause_during_post_batch_hash_keeps_durable_records(self):
        self.source.write_text(json.dumps([{'id': str(i), 'messages': [{'role': 'user', 'text': str(i)}]}
                                           for i in range(70)]))
        plan = m.plan(self.source, self.workspace, 'generic', 'generic-json')
        requested = [False]
        def progress(event):
            if event.get('processed_records', 0) >= 50:
                requested[0] = True
        paused = m.run(self.workspace, plan['checkpoint'], max_records=50,
                       should_pause=lambda: requested[0], on_progress=progress)
        self.assertTrue(paused['paused'])
        self.assertTrue(paused['verification_pending'])
        self.assertTrue(all(key not in paused for key in m.FINDING_COUNTS))
        self.assertEqual(paused['normalized_records'], 50)
        self.assertEqual(m.review(self.workspace)['checkpoint'], paused['checkpoint'])
        resumed = m.auto_run(self.workspace, paused['checkpoint'])
        self.assertEqual(resumed['normalized_records'], 70)
        self.assertEqual(resumed['preserved_only_units'], 0)

    def test_run_preflight_pause_marks_verification_pending(self):
        self.source.write_bytes(archive_bytes(3))
        plan = m.plan(self.source, self.workspace, 'generic', 'documents')
        entered, events, original_view = [False], [], m._zip_view
        def preflight(*args, **kwargs):
            entered[0] = True
            return original_view(*args, **kwargs)
        with patch.object(m, '_zip_view', preflight), patch.object(zipfile, 'ZipInfo') as constructor:
            paused = m.run(self.workspace, plan['checkpoint'], should_pause=lambda: entered[0], on_progress=events.append)
            constructor.assert_not_called()
        self.assertTrue(paused['verification_pending'])
        self.assertTrue(paused['paused'])
        self.assertFalse(paused['complete'])
        self.assertEqual(paused['checkpoint'], plan['checkpoint'])
        self.assertTrue(all(key not in paused for key in m.FINDING_COUNTS))
        self.assertTrue(events[-1]['verification_pending'])
        self.assertTrue(all(key not in events[-1] for key in m.FINDING_COUNTS))
        self.assertNotEqual(events[-1]['progress_percent'], 100)
        self.assertEqual(m.auto_run(self.workspace, paused['checkpoint'])['normalized_records'], 3)

    def test_prefix_zip64_plan_resume_export_round_trip(self):
        raw = archive_bytes(3, b'Comment', True, b'Inert preamble')
        self.source.write_bytes(raw)
        plan = m.plan(self.source, self.workspace, 'generic', 'documents')
        first = m.run(self.workspace, plan['checkpoint'], max_units=1)
        done = m.auto_run(self.workspace, first['checkpoint'], max_units=1)
        self.assertEqual(done['normalized_records'], 3)
        output = self.root / 'portable'
        m.export(self.workspace, done['checkpoint'], output, 'generic', include_source=True)
        self.assertEqual((output / 'original-export.bin').read_bytes(), raw)
        self.assertEqual(m.verify_export(output)['verified_files'], 7)

    def test_selected_source_metadata_swap_cannot_bind_other_units(self):
        def named_archive(name):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                archive.writestr(name, b'synthetic context')
            return stream.getvalue()
        original_bytes, other_bytes = named_archive('alpha.txt'), named_archive('beta.txt')
        self.source.write_bytes(original_bytes)
        original_units, calls = m.zip_units, [0]
        selected = io.BytesIO(original_bytes)
        def swapped(stream, *args, **kwargs):
            calls[0] += 1
            if calls[0] != 1:
                return original_units(stream, *args, **kwargs)
            stream.seek(0)
            stream.truncate()
            stream.write(other_bytes)
            stream.seek(0)
            try:
                return original_units(stream, *args, **kwargs)
            finally:
                stream.seek(0)
                stream.truncate()
                stream.write(original_bytes)
                stream.seek(0)
        # A mutable selected stream models POSIX races without trying to defeat
        # Windows' real read handle, which deliberately prevents external writes.
        with patch.object(m, 'open_input', return_value=selected), patch.object(m, 'zip_units', swapped):
            plan = m.plan(self.source, self.workspace, 'generic', 'documents')
        self.assertEqual(calls[0], 2)
        self.assertEqual((self.workspace / 'source.bin').read_bytes(), original_bytes)
        checkpoint = json.loads((self.workspace / 'checkpoint.json').read_bytes())['data']
        self.assertEqual([item['member'] for item in checkpoint['units']], ['alpha.txt'])
        done = m.auto_run(self.workspace, plan['checkpoint'])
        self.assertEqual(done['normalized_records'], 1)
        self.assertEqual(done['preserved_only_units'], 0)

    def test_cancelled_private_snapshot_preflight_has_no_checkpoint(self):
        original_bytes = archive_bytes(3)
        self.source.write_bytes(original_bytes)
        original_view, calls = m._zip_view, [0]
        def preflight(*args, **kwargs):
            calls[0] += 1
            return original_view(*args, **kwargs)
        with patch.object(m, '_zip_view', preflight):
            with self.assertRaises(m.SnapshotCancelled):
                m.plan(self.source, self.workspace, 'generic', 'documents', should_pause=lambda: calls[0] >= 2)
        self.assertFalse((self.workspace / 'checkpoint.json').exists())
        self.assertEqual((self.workspace / 'source.bin').read_bytes(), original_bytes)
        self.assertEqual(self.source.read_bytes(), original_bytes)
        self.assertTrue(m.purge(self.workspace, incomplete=True)['removed'])

    def test_progress_explicitly_enters_and_clears_verification_pending(self):
        self.source.write_text(json.dumps([{'id': 'a', 'messages': [{'role': 'user', 'text': 'inert'}]}]))
        plan = m.plan(self.source, self.workspace, 'generic', 'generic-json')
        events = []
        m.auto_run(self.workspace, plan['checkpoint'], on_progress=events.append)
        self.assertTrue(events[0]['verification_pending'])
        self.assertTrue(all(key not in events[0] for key in m.FINDING_COUNTS))
        verified = [event for event in events if event['phase'] == 'processing']
        self.assertTrue(verified)
        self.assertTrue(all(event['verification_pending'] is False for event in verified))
        self.assertFalse(events[-1]['verification_pending'])

    def test_older_checkpoint_unit_binding_rejected_before_parse_and_export(self):
        for zipped, mutation in ((True, 'member'), (True, 'size'), (False, 'member'),
                                  (False, 'size'), (True, 'container')):
            with self.subTest(zipped=zipped, mutation=mutation):
                workspace = self.root / f'old-{zipped}-{mutation}'
                self.source.write_bytes(archive_bytes() if zipped else b'Synthetic document')
                plan = m.plan(self.source, workspace, 'generic', 'documents')
                done = m.auto_run(workspace, plan['checkpoint'])
                store = m.Store(workspace)
                try:
                    data, digest = store.checkpoint()
                    if mutation == 'member':
                        data['units'][0]['member'] = 'unrelated.txt'
                    elif mutation == 'size':
                        data['units'][0]['bytes'] += 1
                    else:
                        data['zip'] = False
                    changed = store.save(data, digest)
                finally:
                    store.close()
                for operation in (lambda: m.run(workspace, changed), lambda: m.review(workspace),
                        lambda: m.export(workspace, changed, workspace.with_name(workspace.name + '-export'), 'generic')):
                    with self.assertRaises(m.IntegrityError):
                        operation()
                self.assertEqual(json.loads((workspace / 'checkpoint.json').read_bytes())['digest'], changed)
                self.assertEqual(len(data['omissions']), 0)
                self.assertEqual(done['normalized_records'], 1)


if __name__ == '__main__':
    unittest.main()
