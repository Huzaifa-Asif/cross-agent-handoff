"""Synthetic Windows native tests; skips are NOT evidence of Windows support.

Run on an ordinary 64-bit Windows 10 1809+/11 user account and fixed NTFS temp
volume. Symlink tests require existing symlink permission and skip otherwise;
they never enable developer mode or adjust any security policy.
"""
import ctypes as c
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import windows_io as w


class WindowsPathTests(unittest.TestCase):
    def test_valid_paths_and_unicode(self):
        self.assertEqual(w._parts('c:/Users/Example/launch plan.json'),
                         ('C:\\', ['Users', 'Example', 'launch plan.json']))
        self.assertEqual(w._name('context-日本語.json'), 'context-日本語.json')

    def test_reject_ambiguous_or_namespace_paths(self):
        for path in ('C:relative', '\\rooted', '\\\\server\\share\\x',
                     '\\\\?\\C:\\x', '\\\\.\\NUL', 'C:\\a\\..\\b',
                     'C:\\a\\.\\b', 'C:\\a\\b:stream', 'C:\\a\\bad.',
                     'C:\\a\\bad ', 'C:\\a\\\\b', 'C:\\NUL.txt',
                     'C:\\COM¹.txt', 'C:\\CON .txt', 'C:\\x\x00z',
                     'C:\\bad\ud800', 'C:\\' + 'x' * 256):
            with self.subTest(path=repr(path)), self.assertRaises(ValueError):
                w._parts(path)

    def test_names_cannot_escape_single_component(self):
        for name in ('', '.', '..', '../x', 'a\\b', ':', 'x?', 'LPT9.log',
                     'CONIN$', 'a\nfile', 'foo.', 'bar '):
            with self.subTest(name=repr(name)), self.assertRaises(ValueError):
                w._name(name)

    def test_64_bit_native_structure_layout(self):
        if c.sizeof(c.c_void_p) != 8:
            self.skipTest('64-bit backend only')
        self.assertEqual(c.sizeof(w._Object), 48)
        self.assertEqual(c.sizeof(w._Unicode), 16)
        self.assertEqual(c.sizeof(w._IOSB), 16)
        self.assertEqual(c.sizeof(w._Info), 52)
        self.assertEqual(w._Rename.RootDirectory.offset, 8)
        self.assertEqual(w._Rename.FileName.offset, 20)
        self.assertEqual(c.sizeof(w._Overlapped), 32)

    @unittest.skipIf(os.name == 'nt', 'Non-Windows fail-closed check')
    def test_non_windows_is_explicitly_unsupported(self):
        self.assertFalse(w.capability())
        with self.assertRaises(OSError):
            w.Directory('C:\\synthetic')


@unittest.skipUnless(os.name == 'nt', 'Requires real native Windows calls')
class WindowsNativeTests(unittest.TestCase):
    def setUp(self):
        if not w.capability():
            self.fail('Native backend unavailable on Windows test host')
        self.temp = tempfile.TemporaryDirectory(prefix='handoff-native-')
        self.root = Path(self.temp.name)
        self.path = self.root / 'private'
        # Policy mismatch is a failure: native CI must use fixed local NTFS.
        self.directory = w.Directory(self.path, create=True)

    def tearDown(self):
        self.directory.close()
        self.temp.cleanup()

    def test_private_acl_only_effective_user_and_system(self):
        self.directory.write('private.bin', b'not real user data')
        api = self.directory.api
        advapi = api.a
        get_security = advapi.GetSecurityInfo
        get_security.argtypes = [w.P, w.U32, w.U32, w.P, w.P, w.P, w.P, c.POINTER(w.P)]
        get_security.restype = w.U32
        convert = advapi.ConvertSecurityDescriptorToStringSecurityDescriptorW
        convert.argtypes = [w.P, w.U32, w.U32, c.POINTER(w.P), w.P]
        convert.restype = w.I32
        for handle in (self.directory._handle(),
                       api.child(self.directory._handle(), 'private.bin', w.ATTR | w.SYNC | 0x20000)):
            descriptor, string = w.P(), w.P()
            try:
                self.assertEqual(get_security(handle, 1, 4, None, None, None, None, c.byref(descriptor)), 0)
                api.check(convert(descriptor, 1, 4, c.byref(string), None))
                text = c.wstring_at(string)
                self.assertTrue(text.startswith('D:P'), text)
                self.assertEqual(text.count('(A;'), 2, text)
                self.assertIn(';;;SY)', text)
                self.assertNotIn(';;;WD)', text)
                self.assertNotIn(';;;BA)', text)
            finally:
                if string.value:
                    api.k.LocalFree(string)
                if descriptor.value:
                    api.k.LocalFree(descriptor)
                if handle != self.directory._handle():
                    api.close(handle)

    def test_streaming_limits_and_no_truncation(self):
        with self.directory.open('source.bin', 'wb', exclusive=True) as stream:
            stream.write(b'first\x00second' * 10000)
        with self.directory.open('source.bin') as stream:
            self.assertEqual(stream.read(6), b'first\x00')
            with self.assertRaises(OSError):
                self.directory.unlink('source.bin')
        with self.assertRaises(ValueError):
            self.directory.read('source.bin', 10)
        with self.assertRaises(FileExistsError):
            self.directory.open('source.bin', 'wb')
        for mode in ('ab', 'r+b', 'w', 'rb+'):
            with self.assertRaises(ValueError):
                self.directory.open('source.bin', mode)
        self.assertEqual(len(self.directory.read('source.bin', 200000)), 120000)

    def test_atomic_exclusive_and_checkpoint_replacement(self):
        self.directory.write('checkpoint.json', b'old')
        with self.assertRaises(FileExistsError):
            self.directory.write('checkpoint.json', b'must not replace')
        self.assertEqual(self.directory.read('checkpoint.json', 100), b'old')
        self.directory.write('checkpoint.json', b'new', replace=True)
        self.assertEqual(self.directory.read('checkpoint.json', 100), b'new')
        self.assertEqual(self.directory.names(), ['checkpoint.json'])
        self.assertEqual(self.directory.names(), ['checkpoint.json'])
        self.assertTrue(self.directory.is_regular('checkpoint.json'))
        self.directory.unlink('checkpoint.json')
        self.assertEqual(self.directory.names(), [])

    def test_lock_is_exclusive_and_cannot_be_unlinked(self):
        with self.directory.lock():
            with self.assertRaises(OSError):
                with self.directory.lock():
                    self.fail('Second lock acquired')
            with self.assertRaises(OSError):
                self.directory.unlink('lock')
        with self.directory.lock():
            pass
        self.directory.unlink('lock')

    def test_lock_conflicts_across_processes(self):
        # Child opens ONLY the synthetic, already-pinned workspace's lock file.
        # It uses its own handle/process, not a mocked lock implementation.
        script = '''import ctypes as c, sys, windows_io as w
a=w._api()
h=a.k.CreateFileW(sys.argv[1], w.READ|w.WRITE|w.ATTR|w.SYNC, 3, None, 3, 0x00200000, None)
if h == w.P(-1).value: raise RuntimeError('Cannot open synthetic lock')
try:
 a.info(h)
 overlap=w._Overlapped()
 result=a.k.LockFileEx(h,3,0,1,0,c.byref(overlap))
 code=w._last_error()
 if result:
  a.k.UnlockFileEx(h,0,1,0,c.byref(overlap))
 sys.exit(0 if not result and code==33 else 1)
finally: a.close(h)
'''
        with self.directory.lock():
            completed = subprocess.run([sys.executable, '-c', script,
                str(self.path / 'lock')], cwd=Path(w.__file__).parent,
                capture_output=True, timeout=15)
            self.assertEqual(completed.returncode, 0, completed.stderr.decode(errors='replace'))

    def test_reader_prevents_checkpoint_replace_and_failed_temp_is_cleaned(self):
        self.directory.write('checkpoint.json', b'old')
        with self.directory.open('checkpoint.json') as reader:
            with self.assertRaises(OSError):
                self.directory.write('checkpoint.json', b'new', replace=True)
            self.assertEqual(reader.read(), b'old')
            self.assertEqual(self.directory.names(), ['checkpoint.json'])
        self.directory.write('checkpoint.json', b'new', replace=True)
        self.assertEqual(self.directory.read('checkpoint.json', 20), b'new')

    def test_pinned_directory_blocks_leaf_rename(self):
        with self.assertRaises(OSError):
            self.path.rename(self.path.with_name('moved'))
        with self.assertRaises(OSError):
            w.Directory(self.path)
        self.directory.write('still-here', b'context')
        self.assertEqual((self.path / 'still-here').read_bytes(), b'context')

    def test_ancestor_rename_cannot_redirect_handle_operations(self):
        moved = self.root.with_name(self.root.name + '-moved')
        self.root.rename(moved)
        try:
            self.root.mkdir()
            (self.root / 'private').mkdir()
            self.directory.write('original-only', b'inert')
            self.assertEqual((moved / 'private' / 'original-only').read_bytes(), b'inert')
            self.assertFalse((self.root / 'private' / 'original-only').exists())
        finally:
            (self.root / 'private').rmdir()
            self.root.rmdir()
            moved.rename(self.root)

    def test_remove_requires_empty_and_retains_close_contract(self):
        self.directory.write('record', b'data')
        with self.assertRaises(OSError):
            self.directory.remove()
        self.directory.unlink('record')
        self.directory.remove()
        with self.assertRaises(OSError):
            self.directory.names()
        self.directory.close()
        self.assertFalse(self.path.exists())
        self.directory.close()

    def test_selected_stream_and_exclusive_task_outputs(self):
        selected, target = self.root / 'selected.json', self.root / 'task.json'
        selected.write_bytes(b'UNTRUSTED $(never run)')
        with w.open_file(selected) as stream:
            self.assertEqual(stream.read(), selected.read_bytes())
        w.write_file(target, b'output')
        with self.assertRaises(FileExistsError):
            w.write_file(target, b'replacement')
        self.assertEqual(w.read_file(target, 6), b'output')
        w.purge_file(target)
        self.assertFalse(target.exists())

    def _symlink(self, link, target, directory=False):
        try:
            os.symlink(target, link, target_is_directory=directory)
        except OSError as error:
            if getattr(error, 'winerror', None) == 1314:
                self.skipTest('Host has no existing symlink privilege; policy unchanged')
            raise

    def test_reparse_leaf_never_reads_writes_or_deletes_target(self):
        outside = self.root / 'outside.json'
        outside.write_bytes(b'protected')
        link = self.path / 'link.json'
        self._symlink(link, outside)
        for action in (lambda: self.directory.read('link.json', 100),
                       lambda: self.directory.write('link.json', b'bad', replace=True),
                       lambda: self.directory.unlink('link.json'),
                       lambda: self.directory.is_regular('link.json')):
            with self.assertRaises(OSError):
                action()
            self.assertEqual(outside.read_bytes(), b'protected')
        self.assertIn('link.json', self.directory.names())

    def test_reparse_ancestor_refused(self):
        target = self.root / 'outside'
        target.mkdir()
        link = self.root / 'redirected'
        self._symlink(link, target, True)
        with self.assertRaises(OSError):
            w.Directory(link)
        with self.assertRaises(OSError):
            w.Directory(link / 'new', create=True)
        self.assertEqual(list(target.iterdir()), [])

    def test_junction_ancestor_refused_without_symlink_privileges(self):
        target = self.root / 'junction-target'
        target.mkdir()
        junction = self.root / 'junction'
        completed = subprocess.run(['cmd.exe', '/d', '/c', 'mklink', '/J',
                                    str(junction), str(target)], capture_output=True)
        self.assertEqual(completed.returncode, 0, completed.stderr.decode(errors='replace'))
        try:
            with self.assertRaises(OSError):
                w.Directory(junction)
            with self.assertRaises(OSError):
                w.write_file(junction / 'escape', b'bad')
            self.assertEqual(list(target.iterdir()), [])
        finally:
            os.rmdir(junction)


if __name__ == '__main__':
    unittest.main()
