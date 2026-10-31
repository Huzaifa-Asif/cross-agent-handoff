"""Build deterministic source ZIP from an explicit allowlist; no dependency install."""
from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).resolve().parents[1]
files = [p for p in root.rglob('*') if p.is_file() and not p.is_symlink()
         and (p.parent == root or p.relative_to(root).parts[0] in
              ('docs', 'examples', 'tests', 'scripts', '.github', 'integrations'))
         and '__pycache__' not in p.parts and p.suffix != '.pyc']
dest = root / 'dist'
dest.mkdir(exist_ok=True)
archive = dest / 'cross-agent-handoff-0.4.0-source.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as out:
    for path in sorted(files):
        info = zipfile.ZipInfo('cross-agent-handoff/' + path.relative_to(root).as_posix(), (2026, 1, 1, 0, 0, 0))
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        out.writestr(info, path.read_bytes())
print(f'{archive.name}: {len(files)} files; {archive.stat().st_size} bytes; sha256={hashlib.sha256(archive.read_bytes()).hexdigest()}')
