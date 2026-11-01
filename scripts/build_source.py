"""Build deterministic source ZIP from an explicit allowlist; no dependency install."""
from pathlib import Path
import hashlib
import zipfile

root = Path(__file__).resolve().parents[1]
root_names = {'README.md', 'CHANGELOG.md', 'CHECKPOINT.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
              'LICENSE', 'SECURITY.md', '.gitignore', 'handoff.py', 'handoff_mcp.py', 'migration.py',
              'package.json', 'pyrightconfig.json'}
files = [p for p in root.rglob('*') if p.is_file() and not p.is_symlink()
         and ((p.parent == root and p.name in root_names) or p.relative_to(root).parts[0] in
              ('docs', 'examples', 'tests', 'scripts', '.github', 'integrations', 'bin', 'desktop'))
         and not any(part in ('__pycache__', 'node_modules', 'dist', 'build', 'artifacts', '.stage') for part in p.relative_to(root).parts)
         and p.name not in ('.env', '.npmrc', '.DS_Store')
         and p.suffix not in ('.pyc', '.tgz', '.zip', '.dmg')]
dest = root / 'dist'
dest.mkdir(exist_ok=True)
archive = dest / 'cross-agent-handoff-1.0.0-source.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as out:
    for path in sorted(files):
        info = zipfile.ZipInfo('cross-agent-handoff/' + path.relative_to(root).as_posix(), (2026, 1, 1, 0, 0, 0))
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        out.writestr(info, path.read_bytes())
print(f'{archive.name}: {len(files)} files; {archive.stat().st_size} bytes; sha256={hashlib.sha256(archive.read_bytes()).hexdigest()}')
