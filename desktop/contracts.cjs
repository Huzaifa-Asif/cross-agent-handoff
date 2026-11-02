'use strict';
const PROVIDERS = ['codex', 'claude', 'cursor', 'gemini', 'grok', 'generic'];
const FORMATS = ['claude-json', 'codex-jsonl-experimental', 'generic-json', 'generic-jsonl', 'documents', 'archive'];
function object(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) throw new Error('Unexpected request fields.');
}
function text(value, max = 32768) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error('Enter bounded text without null characters.');
  return value;
}
function choice(value, choices) {
  if (!choices.includes(value)) throw new Error('Unsupported selection.');
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Review this library to refresh its checkpoint.');
  return value;
}
function command(action, input, resolve) {
  const handle = (name, type) => resolve(text(input[name], 80), type);
  const workspace = () => ['--workspace', handle('workspace', 'workspace')];
  const base = () => ['--base-digest', digest(input.checkpoint)];
  switch (action) {
    case 'task-new': {
      object(input, ['goal', 'context', 'preference', 'provider', 'domain', 'output']);
      const args = ['new', '--goal', text(input.goal), '--provider', choice(input.provider, PROVIDERS), '--domain', text(input.domain, 128), '--output', handle('output', 'task-output')];
      if (input.context?.trim()) args.push('--context', text(input.context));
      if (input.preference?.trim()) args.push('--preference', text(input.preference));
      return args;
    }
    case 'task-inspect':
      object(input, ['task']); return ['inspect', handle('task', 'task'), '--include-content'];
    case 'task-export':
      object(input, ['task', 'target', 'output', 'digest']);
      return ['export', handle('task', 'task'), '--provider', choice(input.target, PROVIDERS.filter(x => x !== 'generic')), '--output', handle('output', 'reference-output'), '--expected-digest', digest(input.digest)];
    case 'migration-plan': {
      object(input, ['source', 'workspace', 'provider', 'format', 'expiresAt', 'confirmed']);
      if (input.confirmed !== true) throw new Error('Confirm that you intend a long-term migration.');
      const args = ['migrate', 'plan', handle('source', 'source'), ...workspace(), '--provider', choice(input.provider, PROVIDERS), '--format', choice(input.format, FORMATS), '--confirm-long-term-migration'];
      if (input.expiresAt) args.push('--expires-at', text(input.expiresAt, 40));
      return args;
    }
    case 'migration-run':
      object(input, ['workspace', 'checkpoint']); return ['migrate', 'run', ...workspace(), ...base(), '--max-units', '20', '--max-records', '1000'];
    case 'migration-review':
      object(input, ['workspace', 'offset']);
      if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) throw new Error('Invalid review page.');
      return ['migrate', 'review', ...workspace(), '--offset', String(input.offset || 0), '--limit', '100'];
    case 'migration-search':
      object(input, ['workspace', 'query']); return ['migrate', 'search', ...workspace(), '--query', text(input.query, 256), '--limit', '20'];
    case 'migration-show':
      object(input, ['workspace', 'record']); return ['migrate', 'show', ...workspace(), '--record', text(input.record, 100)];
    case 'migration-redact':
      object(input, ['workspace', 'checkpoint', 'record', 'pointer']);
      return ['migrate', 'redact', ...workspace(), ...base(), '--record', text(input.record, 100), '--pointer', text(input.pointer, 512)];
    case 'migration-export': {
      object(input, ['workspace', 'checkpoint', 'target', 'output', 'confirmed', 'includeOriginal']);
      if (input.confirmed !== true) throw new Error('Review the records and omissions before exporting.');
      if (input.includeOriginal !== undefined && typeof input.includeOriginal !== 'boolean') throw new Error('Invalid original-source selection.');
      const args = ['migrate', 'export', ...workspace(), ...base(), '--target', choice(input.target, PROVIDERS), '--output', handle('output', 'export-output'), '--confirm-reviewed'];
      if (input.includeOriginal === true) args.push('--include-original-source');
      return args;
    }
    case 'migration-verify':
      object(input, ['output']); return ['migrate', 'verify', handle('output', 'export-output')];
    default: throw new Error('Unsupported operation.');
  }
}
module.exports = {command, PROVIDERS, FORMATS};
