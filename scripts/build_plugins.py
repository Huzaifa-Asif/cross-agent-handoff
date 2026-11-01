"""Build deterministic, self-contained host plugin ZIPs and a local marketplace.

No installation, network access, executable hooks or post-install scripts.
"""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
HOSTS = ('codex', 'claude', 'cursor')
VERSION = '1.0.0'
COMMON = ('handoff.py', 'handoff_mcp.py', 'migration.py', 'LICENSE', 'SECURITY.md',
          'examples/example.json', 'examples/business-task.json', 'examples/migration-history.json',
          'docs/schema-v1.json', 'docs/platform-plugins.md',
          'docs/privacy.md', 'docs/migration.md', 'docs/schema-v2.json')


def add_zip(path, files):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)


def build(output):
    """Exclusive output directory prevents deleting or overwriting prior evidence."""
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    payload = {}
    for name in COMMON:
        path = ROOT / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'missing or unsafe packaged input: {name}')
        payload[name] = path.read_bytes()
    payload['README.md'] = (b'# Cross-Agent Handoff local plugin\n\n'
                            b'See [installation and usage](docs/platform-plugins.md), '
                            b'[privacy](docs/privacy.md), and [security](SECURITY.md).\n\n'
                            b'This self-contained package uses Python 3.11+ and contains '
                            b'no third-party runtime dependencies. If you extracted a host ZIP, '
                            b'skip the source-build step in the installation guide and use this '
                            b'directory as the plugin path. Directory listing and real-host '
                            b'UI verification are separate from a successful package build.\n')
    for path in sorted((ROOT / 'integrations/skills').rglob('*')):
        if path.is_symlink():
            raise ValueError('symlink in skill tree')
        if path.is_file():
            payload['skills/' + path.relative_to(ROOT / 'integrations/skills').as_posix()] = path.read_bytes()
    results = {}
    for host in HOSTS:
        files = dict(payload)
        template = ROOT / 'integrations/templates' / host
        for path in sorted(template.rglob('*')):
            if path.is_symlink():
                raise ValueError('symlink in template tree')
            if path.is_file():
                files[path.relative_to(template).as_posix()] = path.read_bytes()
        folder = output / 'plugins' / host
        for name, data in files.items():
            target = folder / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        archive = output / f'cross-agent-handoff-{VERSION}-{host}.zip'
        add_zip(archive, files)
        results[host] = {'archive': archive.name, 'files': len(files),
                         'bytes': archive.stat().st_size,
                         'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
    catalogs = {
        '.agents/plugins/marketplace.json': {
            'name': 'huzaifa-cross-agent-handoff', 'plugins': [{
                'name': 'cross-agent-handoff',
                'source': {'source': 'local', 'path': './plugins/codex'},
                'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'},
                'category': 'Productivity'}]},
        '.claude-plugin/marketplace.json': {
            'name': 'huzaifa-cross-agent-handoff', 'owner': {'name': 'Huzaifa Asif'},
            'metadata': {'description': 'Local tools and skills for reviewable work-context handoffs between coding assistants.'},
            'plugins': [{'name': 'cross-agent-handoff', 'source': './plugins/claude'}]},
        '.cursor-plugin/marketplace.json': {
            'name': 'huzaifa-cross-agent-handoff', 'owner': {'name': 'Huzaifa Asif'},
            'plugins': [{'name': 'cross-agent-handoff', 'source': './plugins/cursor'}]},
    }
    for name, value in catalogs.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    (output / 'manifest.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=str(ROOT / 'dist' / f'plugins-{VERSION}'))
    args = parser.parse_args()
    print(json.dumps(build(args.output), indent=2))


if __name__ == '__main__':
    main()
