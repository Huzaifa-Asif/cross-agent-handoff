"""Fail-closed Windows filesystem backend (64-bit Windows 10 1809 or newer).

Only local fixed NTFS volumes and ordinary, case-insensitive directories are
supported. Reparse points (including OneDrive placeholders/junctions) are refused
at every component. No credentials, privileges or existing ACLs are changed.
New objects have a protected DACL granting only the effective user and SYSTEM.

All traversal after opening the volume root is relative to retained directory
handles. Ancestor rename cannot redirect these handles; the final directory is
pinned against rename until close. Atomic rename operates on an entry in that directory, never on a
followed destination. Atomic publication is not a transaction across files, nor
a guarantee against disk/controller power loss. Existing directories need the
ordinary access rights requested below. ACLs do not protect against that same
user or an administrator deliberately modifying data.

rb streams pin the file against writes/deletion until close. wb/xb streams always
create a NEW file; truncation/append/update are deliberately unsupported. remove()
marks an empty directory for deletion; caller must then close it. lock() denies
delete-sharing: purge must release its lock before unlinking 'lock'; a concurrent
acquirer makes that unlink fail safely. No recursive deletion is provided.

API references (Microsoft/Python, checked 2026-11-01):
https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile
https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information
https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntquerydirectoryfile
https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex
https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationbyhandlew
https://learn.microsoft.com/en-us/windows/win32/api/sddl/nf-sddl-convertstringsecuritydescriptortosecuritydescriptorw
https://docs.python.org/3/library/msvcrt.html#msvcrt.open_osfhandle
"""

from contextlib import contextmanager
import ctypes as c
import errno
from importlib import import_module
import ntpath
import os
import re
import sys
import uuid
from typing import Any

U8, U16, U32, I32 = c.c_uint8, c.c_uint16, c.c_uint32, c.c_int32
P, SIZE = c.c_void_p, c.c_size_t
READ, WRITE, ATTR, SYNC, DELETE = 1, 2, 0x80, 0x100000, 0x10000
DIR_ACCESS = 1 | 0x20 | ATTR | SYNC | 0x20000  # READ_CONTROL for ACL inspection.
REPARSE, DIRECTORY = 0x400, 0x10
MAX_NAMES = 200_000


class _Unicode(c.Structure):
    _fields_ = [('Length', U16), ('MaximumLength', U16), ('Buffer', P)]


class _Object(c.Structure):
    _fields_ = [('Length', U32), ('RootDirectory', P),
                ('ObjectName', c.POINTER(_Unicode)), ('Attributes', U32),
                ('SecurityDescriptor', P), ('SecurityQualityOfService', P)]


class _IOSB(c.Structure):
    _fields_ = [('Status', P), ('Information', SIZE)]


class _Info(c.Structure):
    _fields_ = [('attributes', U32), ('creation', U32 * 2),
                ('access', U32 * 2), ('write', U32 * 2), ('volume', U32),
                ('size_high', U32), ('size_low', U32), ('links', U32),
                ('index_high', U32), ('index_low', U32)]


class _Rename(c.Structure):
    _fields_ = [('ReplaceIfExists', U8), ('RootDirectory', P),
                ('FileNameLength', U32), ('FileName', U16 * 1)]


class _Overlapped(c.Structure):
    _fields_ = [('Internal', SIZE), ('InternalHigh', SIZE), ('Offset', U32),
                ('OffsetHigh', U32), ('hEvent', P)]


def _name(value):
    if not isinstance(value, str) or not value or value in ('.', '..'):
        raise ValueError('Invalid Windows filename')
    if value[-1] in ' .' or any(ord(x) < 32 or x in '<>:"/\\|?*' for x in value):
        raise ValueError('Invalid Windows filename')
    stem = value.split('.')[0].rstrip(' ').upper()
    if stem in {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'} or re.fullmatch(r'(COM|LPT)[1-9¹²³]', stem):
        raise ValueError('Reserved Windows filename')
    try:
        encoded = value.encode('utf-16-le')
    except UnicodeError as exc:
        raise ValueError('Invalid Windows filename encoding') from exc
    if len(encoded) > 510:
        raise ValueError('Windows filename is too long')
    return value


def _parts(path):
    value = os.fspath(path)
    if not isinstance(value, str) or not value or '\x00' in value:
        raise ValueError('Invalid Windows path')
    value = value.replace('/', '\\')
    if value.startswith('\\'):
        raise ValueError('Device, UNC and rooted paths are unsupported')
    drive, tail = ntpath.splitdrive(value)
    if drive and (not re.fullmatch('[A-Za-z]:', drive) or not tail.startswith('\\')):
        raise ValueError('Drive-relative or device path is unsupported')
    # Validate BEFORE abspath can erase traversal or trailing separators.
    for part in tail.split('\\'):
        if part:
            _name(part)
    if '\\\\' in tail:
        raise ValueError('Empty Windows path component')
    if not drive:
        if os.name != 'nt':
            raise ValueError('An absolute Windows drive path is required')
        value = ntpath.abspath(value)
        drive, tail = ntpath.splitdrive(value)
        if not re.fullmatch('[A-Za-z]:', drive) or not tail.startswith('\\'):
            raise ValueError('An absolute Windows drive path is required')
    parts = [x for x in tail.split('\\') if x]
    for part in parts:
        _name(part)
    if len(value.encode('utf-16-le')) > 65500:
        raise ValueError('Windows path is too long')
    return drive.upper() + '\\', parts


def _failure(code):
    mapping = {2: errno.ENOENT, 3: errno.ENOENT, 5: errno.EACCES,
               32: errno.EACCES, 33: errno.EAGAIN, 80: errno.EEXIST,
               183: errno.EEXIST, 145: errno.ENOTEMPTY, 267: errno.ENOTDIR}
    error = OSError(mapping.get(code, errno.EIO), 'Safe Windows filesystem operation failed')
    setattr(error, 'winerror', code)
    return error


class _API:
    # ctypes exports are dynamically bound; annotations also let POSIX static
    # analysis inspect this module without pretending Windows APIs exist there.
    k: Any
    a: Any
    n: Any

    def __init__(self):
        if os.name != 'nt' or c.sizeof(P) != 8 or sys.getwindowsversion().build < 17763:
            raise OSError(errno.ENOTSUP, 'Requires 64-bit Windows 10 1809 or newer')
        self.k = c.WinDLL('kernel32', use_last_error=True)
        self.a = c.WinDLL('advapi32', use_last_error=True)
        self.n = c.WinDLL('ntdll', use_last_error=True)
        definitions = [
            (self.k, 'CreateFileW', P, [c.c_wchar_p, U32, U32, P, U32, U32, P]),
            (self.k, 'CloseHandle', I32, [P]),
            (self.k, 'GetFileInformationByHandle', I32, [P, c.POINTER(_Info)]),
            (self.k, 'GetFileInformationByHandleEx', I32, [P, U32, P, U32]),
            (self.k, 'GetVolumeInformationByHandleW', I32, [P, P, U32, P, P, c.POINTER(U32), c.c_wchar_p, U32]),
            (self.k, 'GetFinalPathNameByHandleW', U32, [P, c.c_wchar_p, U32, U32]),
            (self.k, 'GetDriveTypeW', U32, [c.c_wchar_p]),
            (self.k, 'FlushFileBuffers', I32, [P]),
            (self.k, 'SetFileInformationByHandle', I32, [P, U32, P, U32]),
            (self.k, 'LockFileEx', I32, [P, U32, U32, U32, U32, c.POINTER(_Overlapped)]),
            (self.k, 'UnlockFileEx', I32, [P, U32, U32, U32, c.POINTER(_Overlapped)]),
            (self.k, 'GetCurrentProcess', P, []),
            (self.k, 'GetCurrentThread', P, []),
            (self.k, 'LocalFree', P, [P]),
            (self.a, 'OpenProcessToken', I32, [P, U32, c.POINTER(P)]),
            (self.a, 'OpenThreadToken', I32, [P, U32, I32, c.POINTER(P)]),
            (self.a, 'GetTokenInformation', I32, [P, U32, P, U32, c.POINTER(U32)]),
            (self.a, 'ConvertSidToStringSidW', I32, [P, c.POINTER(P)]),
            (self.a, 'ConvertStringSecurityDescriptorToSecurityDescriptorW', I32, [c.c_wchar_p, U32, c.POINTER(P), P]),
            (self.n, 'NtCreateFile', I32, [c.POINTER(P), U32, c.POINTER(_Object), c.POINTER(_IOSB), P, U32, U32, U32, U32, P, U32]),
            (self.n, 'NtSetInformationFile', I32, [P, c.POINTER(_IOSB), P, U32, U32]),
            (self.n, 'NtQueryDirectoryFile', I32, [P, P, P, P, c.POINTER(_IOSB), P, U32, U32, U8, P, U8]),
            (self.n, 'RtlNtStatusToDosError', U32, [I32]),
        ]
        for library, name, result, arguments in definitions:
            function = getattr(library, name)
            function.restype, function.argtypes = result, arguments

    def check(self, result):
        if not result:
            raise _failure(_last_error())

    def status(self, result):
        if result < 0:
            raise _failure(self.n.RtlNtStatusToDosError(result))

    def close(self, handle):
        self.check(self.k.CloseHandle(handle))

    @contextmanager
    def security(self):
        token, sid_text, descriptor = P(), P(), P()
        try:
            if not self.a.OpenThreadToken(self.k.GetCurrentThread(), 8, 1, c.byref(token)):
                if _last_error() != 1008:  # ERROR_NO_TOKEN, not access denied.
                    raise _failure(_last_error())
                self.check(self.a.OpenProcessToken(self.k.GetCurrentProcess(), 8, c.byref(token)))
            required = U32()
            self.a.GetTokenInformation(token, 1, None, 0, c.byref(required))
            if _last_error() != 122 or not 0 < required.value <= 65536:
                raise OSError(errno.EACCES, 'Cannot obtain effective Windows user')
            buffer = c.create_string_buffer(required.value)
            self.check(self.a.GetTokenInformation(token, 1, buffer, len(buffer), c.byref(required)))
            sid = c.cast(buffer, c.POINTER(P))[0]  # TOKEN_USER begins SID_AND_ATTRIBUTES.
            self.check(self.a.ConvertSidToStringSidW(sid, c.byref(sid_text)))
            user = c.wstring_at(sid_text)
            if not re.fullmatch(r'S-1-[0-9-]+', user):
                raise OSError(errno.EACCES, 'Invalid effective Windows SID')
            sddl = 'O:' + user + 'D:P(A;;FA;;;SY)(A;;FA;;;' + user + ')'
            self.check(self.a.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, c.byref(descriptor), None))
            yield descriptor
        finally:
            if descriptor.value:
                self.k.LocalFree(descriptor)
            if sid_text.value:
                self.k.LocalFree(sid_text)
            if token.value:
                self.close(token)

    def info(self, handle, directory=False):
        info = _Info()
        self.check(self.k.GetFileInformationByHandle(handle, c.byref(info)))
        if info.attributes & REPARSE or bool(info.attributes & DIRECTORY) != directory:
            raise OSError(errno.EINVAL, 'Reparse points and nonordinary objects are unsupported')
        if directory:
            flags = U32()
            self.check(self.k.GetFileInformationByHandleEx(handle, 23, c.byref(flags), c.sizeof(flags)))
            if flags.value:
                raise OSError(errno.ENOTSUP, 'Case-sensitive Windows directories are unsupported')
        return info

    def root(self, root):
        handle = self.k.CreateFileW('\\\\?\\' + root, DIR_ACCESS, 7, None, 3, 0x02200000, None)
        if handle == P(-1).value:
            raise _failure(_last_error())
        try:
            self.info(handle, True)
            fs, flags = c.create_unicode_buffer(32), U32()
            self.check(self.k.GetVolumeInformationByHandleW(handle, None, 0, None, None, c.byref(flags), fs, len(fs)))
            volume = c.create_unicode_buffer(1024)
            length = self.k.GetFinalPathNameByHandleW(handle, volume, len(volume), 1)
            if not length or length >= len(volume):
                raise OSError(errno.ENOTSUP, 'Cannot identify local Windows volume')
            if (fs.value != 'NTFS' or not flags.value & 8 or
                    not re.fullmatch(r'\\\\\?\\Volume\{[0-9A-Fa-f-]+\}\\', volume.value) or
                    self.k.GetDriveTypeW(volume.value) != 3):
                raise OSError(errno.ENOTSUP, 'Requires a local fixed NTFS volume')
            return handle
        except BaseException:
            self.close(handle)
            raise

    def child(self, parent, name, access, disposition=1, directory=False, share=1):
        encoded = _name(name).encode('utf-16-le')
        buffer = c.create_string_buffer(encoded)
        text = _Unicode(len(encoded), len(encoded), c.cast(buffer, P))
        # OBJ_CASE_INSENSITIVE; each single component is opened without following
        # its reparse point, then verified on that SAME handle.
        obj = _Object(c.sizeof(_Object), parent, c.pointer(text), 0x40, None, None)
        handle, status = P(), _IOSB()
        options = 0x00200000 | 0x20 | (1 if directory else 0x40)
        if disposition != 1:
            with self.security() as descriptor:
                obj.SecurityDescriptor = descriptor
                result = self.n.NtCreateFile(c.byref(handle), access, c.byref(obj), c.byref(status), None, 0x80, share, disposition, options, None, 0)
        else:
            result = self.n.NtCreateFile(c.byref(handle), access, c.byref(obj), c.byref(status), None, 0x80, share, disposition, options, None, 0)
        self.status(result)
        try:
            self.info(handle, directory)
            return handle
        except BaseException:
            self.close(handle)
            raise

    def delete(self, handle):
        flag = U8(1)
        self.check(self.k.SetFileInformationByHandle(handle, 4, c.byref(flag), 1))

    def rename(self, handle, parent, name, replace):
        encoded = _name(name).encode('utf-16-le')
        buffer = c.create_string_buffer(_Rename.FileName.offset + len(encoded))
        header = c.cast(buffer, c.POINTER(_Rename)).contents
        header.ReplaceIfExists, header.RootDirectory = int(replace), parent
        header.FileNameLength = len(encoded)
        c.memmove(c.addressof(buffer) + _Rename.FileName.offset, encoded, len(encoded))
        status = _IOSB()
        self.status(self.n.NtSetInformationFile(handle, c.byref(status), buffer, len(buffer), 10))


_backend = None


def _last_error():
    return getattr(c, 'get_last_error')()


def _crt() -> Any:
    return import_module('msvcrt')


def _api():
    global _backend
    if _backend is None:
        _backend = _API()
    return _backend


def capability():
    """Whether required native APIs exist; each operation also checks its volume."""
    try:
        _api()
        return True
    except (OSError, AttributeError):
        return False


def _stream(api, handle, mode):
    msvcrt = _crt()
    numeric = handle.value if isinstance(handle, P) else handle
    if not isinstance(numeric, int) or numeric in (0, -1):
        raise OSError(errno.EBADF, 'Invalid Windows stream handle')
    try:
        flags = getattr(os, 'O_BINARY') | getattr(os, 'O_NOINHERIT') | (os.O_RDONLY if mode == 'rb' else os.O_WRONLY)
        descriptor = msvcrt.open_osfhandle(numeric, flags)
    except BaseException:
        api.close(handle)
        raise
    try:
        return os.fdopen(descriptor, mode)
    except BaseException:
        os.close(descriptor)
        raise


class Directory:
    def __init__(self, path, create=False):
        root, parts = _parts(path)
        self.api = _api()
        self.handles = []
        self.removed = False
        try:
            self.handles.append(self.api.root(root))
            for index, part in enumerate(parts):
                final = index == len(parts) - 1
                access = DIR_ACCESS | (DELETE if final else 0)
                self.handles.append(self.api.child(self.handles[-1], part, access,
                                                  2 if create and final else 1, True, 3 if final else 7))
            if create and not parts:
                raise ValueError('Cannot create a Windows volume root')
            self._root_only = not parts
        except BaseException:
            self.close()
            raise

    def _handle(self):
        if not self.handles or self.removed:
            raise OSError(errno.EBADF, 'Windows directory is closed or pending deletion')
        return self.handles[-1]

    def close(self):
        handles, self.handles = self.handles, []
        first = None
        for handle in reversed(handles):
            try:
                self.api.close(handle)
            except OSError as exc:
                first = first or exc
        if first:
            raise first

    def __enter__(self):
        self._handle()
        return self

    def __exit__(self, *_):
        self.close()

    def open(self, name, mode='rb', exclusive=False):
        if mode not in ('rb', 'wb', 'xb') or (mode == 'rb' and exclusive):
            raise ValueError('Only rb and create-new wb/xb streams are supported')
        writing = mode != 'rb'
        handle = self.api.child(self._handle(), name, (WRITE if writing else READ) | ATTR | SYNC,
                                2 if writing else 1)
        return _stream(self.api, handle, 'wb' if writing else 'rb')

    def read(self, name, limit):
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 0:
            raise ValueError('Invalid Windows read limit')
        with self.open(name) as stream:
            if os.fstat(stream.fileno()).st_size > limit:
                raise ValueError('Windows file exceeds read limit')
            data = stream.read(limit + 1)
            if len(data) > limit:
                raise ValueError('Windows file exceeds read limit')
            return data

    def write(self, name, data, replace=False):
        _name(name)
        if not isinstance(data, bytes):
            raise ValueError('Windows writes require bytes')
        # Refuse a stable destination reparse point/directory even for replace.
        # The eventual rename never follows a raced destination entry either.
        if replace:
            try:
                self.is_regular(name)
            except FileNotFoundError:
                pass
        temporary = '.pending-' + uuid.uuid4().hex
        handle = self.api.child(self._handle(), temporary, WRITE | ATTR | SYNC | DELETE, 2)
        published = False
        try:
            msvcrt = _crt()
            with _stream(self.api, handle, 'wb') as stream:
                handle = msvcrt.get_osfhandle(stream.fileno())
                stream.write(data)
                stream.flush()
                self.api.check(self.api.k.FlushFileBuffers(handle))
                self.api.rename(handle, self._handle(), name, replace)
                published = True
        finally:
            if not published:
                try:
                    self.unlink(temporary)
                except FileNotFoundError:
                    pass

    @contextmanager
    def lock(self):
        handle = self.api.child(self._handle(), 'lock', READ | WRITE | ATTR | SYNC, 3, share=3)
        overlapped = _Overlapped()
        locked = False
        try:
            self.api.check(self.api.k.LockFileEx(handle, 3, 0, 1, 0, c.byref(overlapped)))
            locked = True
            yield
        finally:
            try:
                if locked:
                    self.api.check(self.api.k.UnlockFileEx(handle, 0, 1, 0, c.byref(overlapped)))
            finally:
                self.api.close(handle)

    def names(self):
        result, restart = [], True
        # NtQueryDirectoryFile has a handle-local cursor. RestartScan resets it;
        # Directory instances are intentionally not thread-safe.
        buffer, status = c.create_string_buffer(65536), _IOSB()
        while True:
            code = self.api.n.NtQueryDirectoryFile(self._handle(), None, None, None,
                c.byref(status), buffer, len(buffer), 12, 0, None, int(restart))
            restart = False
            if code & 0xFFFFFFFF == 0x80000006:
                break
            self.api.status(code)
            size, offset = int(status.Information), 0
            if not 0 < size <= len(buffer):
                raise OSError(errno.EIO, 'Invalid Windows directory response')
            while True:
                if offset + 12 > size:
                    raise OSError(errno.EIO, 'Invalid Windows directory entry')
                next_offset = U32.from_buffer(buffer, offset).value
                length = U32.from_buffer(buffer, offset + 8).value
                if length % 2 or length > 510 or offset + 12 + length > size:
                    raise OSError(errno.EIO, 'Invalid Windows directory entry')
                name = bytes(buffer[offset + 12:offset + 12 + length]).decode('utf-16-le')
                if name not in ('.', '..'):
                    result.append(_name(name))
                    if len(result) > MAX_NAMES:
                        raise ValueError('Too many Windows directory entries')
                if not next_offset:
                    break
                if next_offset < 12 + length or next_offset % 4 or offset + next_offset >= size:
                    raise OSError(errno.EIO, 'Invalid Windows directory entry offset')
                offset += next_offset
        return result

    def is_regular(self, name):
        # Unsupported entries raise rather than reporting a trustworthy False.
        handle = self.api.child(self._handle(), name, ATTR | SYNC, share=7)
        self.api.close(handle)
        return True

    def unlink(self, name):
        handle = self.api.child(self._handle(), name, ATTR | SYNC | DELETE, share=7)
        try:
            self.api.delete(handle)
        finally:
            self.api.close(handle)

    def remove(self):
        if self._root_only:
            raise ValueError('Cannot remove a Windows volume root')
        self.api.delete(self._handle())
        self.removed = True


def _parent(path):
    root, parts = _parts(path)
    if not parts:
        raise ValueError('A Windows file path is required')
    return Directory(root + '\\'.join(parts[:-1])), parts[-1]


def open_file(path, mode='rb', exclusive=False):
    """Open selected source/new output as a binary stream; caller closes it.

    The file handle pins the file itself. Ancestor handles may close after open:
    later I/O uses the actual opened file, never the pathname again.
    """
    directory, name = _parent(path)
    with directory:
        return directory.open(name, mode, exclusive)


def read_file(path, limit):
    directory, name = _parent(path)
    with directory:
        return directory.read(name, limit)


def write_file(path, data):
    """Atomically publish a new output, refusing any existing destination."""
    directory, name = _parent(path)
    with directory:
        return directory.write(name, data)


def purge_file(path):
    directory, name = _parent(path)
    with directory:
        directory.unlink(name)
