"""Dependency-free syntax and whitespace policy checks, not a full static type checker."""
import ast
from pathlib import Path

root = Path(__file__).resolve().parents[1]
count = 0
for path in sorted(root.rglob('*.py')):
    if any(part in ('dist', 'node_modules', '.stage') for part in path.parts):
        continue
    source = path.read_text(encoding='utf-8')
    ast.parse(source, filename=str(path))
    for number, line in enumerate(source.splitlines(), 1):
        if line.rstrip() != line or '\t' in line:
            raise SystemExit(f'{path}:{number}: trailing whitespace or tab')
    count += 1
print(f'Syntax/whitespace policy passed: {count} Python files (no static type-check claim).')
