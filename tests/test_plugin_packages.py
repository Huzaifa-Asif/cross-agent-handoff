"""Packaging tests simulate documented variable expansion, not real host installs."""
import importlib.util
import json
import posixpath
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_plugins', ROOT / 'scripts/build_plugins.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PackageTests(unittest.TestCase):
    def test_deterministic_archives_and_source_parity(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / 'a', Path(temp) / 'b'
            first, second = builder.build(a), builder.build(b)
            self.assertEqual(first, second)
            for host in builder.HOSTS:
                archive = a / first[host]['archive']
                with zipfile.ZipFile(archive) as zipped:
                    self.assertEqual(len(zipped.namelist()), len(set(zipped.namelist())))
                    for name in zipped.namelist():
                        self.assertFalse(name.startswith('/'))
                        self.assertNotIn('..', Path(name).parts)
                        self.assertNotIn('hooks', Path(name).parts)
                        self.assertNotIn('credentials', name)
                    for name in ('handoff.py', 'handoff_mcp.py', 'LICENSE'):
                        self.assertEqual(zipped.read(name), (ROOT / name).read_bytes())
                    self.assertIn('skills/transfer-handoff/SKILL.md', zipped.namelist())
                    for name in zipped.namelist():
                        if name.endswith('.md'):
                            for link in re.findall(r'\]\(([^)]+)\)', zipped.read(name).decode()):
                                if '://' not in link and not link.startswith('#'):
                                    target = posixpath.normpath(posixpath.join(posixpath.dirname(name), link.split('#')[0]))
                                    self.assertIn(target, zipped.namelist(), (name, link))
            with self.assertRaises(FileExistsError):
                builder.build(a)

    def test_host_configs_and_catalogs(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'marketplace'
            builder.build(out)
            for host, var, config in (
                ('codex', 'PLUGIN_ROOT', 'mcp.json'),
                ('claude', 'CLAUDE_PLUGIN_ROOT', '.mcp.json'),
                ('cursor', 'CURSOR_PLUGIN_ROOT', 'mcp.json'),
            ):
                base = out / 'plugins' / host
                server = json.loads((base / config).read_text())['mcpServers']['handoff']
                self.assertEqual(server['command'], 'python3')
                self.assertEqual(server['type'], 'stdio')
                self.assertEqual(server['args'], ['-B', '${' + var + '}/handoff_mcp.py'])
                self.assertNotIn('env', server)
                self.assertNotIn('url', server)
            for name in ('.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json',
                         '.cursor-plugin/marketplace.json'):
                catalog = json.loads((out / name).read_text())
                source = catalog['plugins'][0]['source']
                relative = source['path'] if isinstance(source, dict) else source
                self.assertTrue((out / relative).is_dir())

    def test_packaged_stdio_launches_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix='handoff plugins ') as temp:
            out = Path(temp) / 'marketplace'
            builder.build(out)
            messages = [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
                    'protocolVersion': '2025-11-25', 'capabilities': {},
                    'clientInfo': {'name': 'package-test', 'version': '1'}}},
                {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
            ]
            for host in builder.HOSTS:
                completed = subprocess.run(
                    [sys.executable, '-B', str(out / 'plugins' / host / 'handoff_mcp.py')],
                    input=''.join(json.dumps(item) + '\n' for item in messages),
                    text=True, capture_output=True, timeout=10, check=True)
                self.assertEqual(completed.stderr, '')
                replies = [json.loads(line) for line in completed.stdout.splitlines()]
                self.assertEqual(replies[0]['id'], 1)
                names = {tool['name'] for tool in replies[-1]['result']['tools']}
                self.assertEqual(names, {'handoff_validate', 'handoff_export', 'handoff_import',
                                         'handoff_compare', 'handoff_continue', 'handoff_redact'})
                self.assertFalse(list(out.rglob('__pycache__')))

    def test_release_metadata_and_claude_marketplace_description(self):
        import handoff_mcp
        self.assertEqual(json.loads((ROOT / 'package.json').read_text())['version'], builder.VERSION)
        self.assertEqual(json.loads((ROOT / 'desktop/package.json').read_text())['version'], builder.VERSION)
        self.assertEqual(handoff_mcp.VERSION, builder.VERSION)
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / 'marketplace'
            results = builder.build(out)
            catalog = json.loads((out / '.claude-plugin/marketplace.json').read_text())
            description = catalog['metadata']['description']
            self.assertIsInstance(description, str)
            self.assertTrue(description.strip())
            for host, manifest in (
                ('codex', 'plugin.json'),
                ('claude', '.claude-plugin/plugin.json'),
                ('cursor', '.cursor-plugin/plugin.json'),
            ):
                plugin = json.loads((out / 'plugins' / host / manifest).read_text())
                self.assertEqual(plugin['version'], builder.VERSION)
                self.assertEqual(results[host]['archive'], f'cross-agent-handoff-{builder.VERSION}-{host}.zip')


if __name__ == '__main__':
    unittest.main()
