'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const python = require('./python.cjs')();
const engine = path.resolve(__dirname, '../../handoff.py');

// Exercise the actual renderer through its public controls, without inspecting
// private state. Native dialogs are synthetic; backend file operations are real.
function harness(review, run) {
  const nodes = new Map(), elements = [], calls = [], outputs = [];
  class Element {
    constructor(tag) {
      Object.assign(this, {tagName:tag.toUpperCase(), disabled:false, hidden:false,
        checked:false, value:'', textContent:'', children:[], handlers:{}, className:''});
      const classes = new Set();
      this.classList = {toggle(name, enabled){
        if (enabled === undefined) enabled = !classes.has(name);
        if (enabled) classes.add(name); else classes.delete(name);
      }, contains:name=>classes.has(name)};
      elements.push(this);
    }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute() {} removeAttribute() {}
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
  }
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)) nodes.set(match[2], new Element(match[1]));
  const api = {
    status:async()=>({ready:true, python:'Synthetic supported runtime'}), onProgress(){}, cancel:async()=>{},
    choose:async kind=>{
      if (kind === 'workspace') return {handle:'workspace', label:'Synthetic selected library'};
      const selected = outputs.shift();
      if (selected instanceof Error) throw selected;
      return selected;
    },
    run:async(action, input)=>{
      calls.push([action, JSON.parse(JSON.stringify(input))]);
      return action === 'migration-review' ? review : run(action, input);
    }
  };
  const document = {getElementById:id=>nodes.get(id), createElement:tag=>new Element(tag), addEventListener(){},
    querySelectorAll:()=>elements.filter(item=>['BUTTON','INPUT','SELECT','TEXTAREA'].includes(item.tagName))};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../renderer.js'), 'utf8'), {document, window:{handoff:api}});
  nodes.get('migration-target').value = 'generic';
  return {nodes, calls, api, choose:output=>outputs.push(output),
    click:id=>nodes.get(id).handlers.click(), open:()=>nodes.get('resume-library').handlers.click(),
    export:async(output, includeOriginal=false)=>{
      outputs.push(output); nodes.get('confirm-reviewed').checked = true;
      nodes.get('include-original').checked = includeOriginal;
      await nodes.get('export-migration').handlers.click();
    }};
}

function cli(args) {
  const result = spawnSync(python, ['-X','utf8','-E','-s','-B',engine,...args],
    {encoding:'utf8', timeout:30000, maxBuffer:4*1024*1024});
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'CLI failed');
  return JSON.parse(result.stdout);
}

function fixture(t, labels=['A'], malformed=false, expiresAt=null) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-export-review-')));
  t.after(()=>fs.rmSync(root, {recursive:true, force:true}));
  const libraries = {};
  for (const label of labels) {
    const source = path.join(root, label+'.json'), workspace = path.join(root, 'library-'+label);
    fs.writeFileSync(source, malformed ? '{' : JSON.stringify({id:label, title:'Synthetic '+label,
      messages:[{role:'user', text:'Distinct inert context '+label, timestamp:'2026-01-01T00:00:00Z'}]}));
    const planned = cli(['migrate','plan',source,'--workspace',workspace,'--provider','generic',
      '--format','generic-json','--confirm-long-term-migration',...(expiresAt ? ['--expires-at',expiresAt] : [])]);
    cli(['migrate','run','--workspace',workspace,'--base-digest',planned.checkpoint]);
    libraries[label] = {workspace, review:cli(['migrate','review','--workspace',workspace])};
  }
  const output = name=>({handle:path.join(root, name), label:name});
  const exportLibrary = (label, target, original=false)=>cli(['migrate','export',
    '--workspace',libraries[label].workspace,'--base-digest',libraries[label].review.checkpoint,
    '--target','generic','--output',target,'--confirm-reviewed',...(original ? ['--include-original-source'] : [])]);
  const h = harness(libraries.A.review, (action, input)=>{
    if (action === 'migration-export') return exportLibrary('A', input.output, input.includeOriginal);
    if (action === 'migration-verify') return cli(['migrate','verify',input.output]);
    throw new Error('Unexpected action '+action);
  });
  return {root, libraries, output, exportLibrary, h};
}

function assertCleared(h, priorLabel) {
  assert.equal(h.nodes.get('verify-export').hidden, true, 'A failed or mismatched copy must require a new export');
  if (priorLabel) assert.equal(h.nodes.get('export-location').textContent.includes(priorLabel), false,
    'Do not label a prior successful copy as the failed new destination');
  assert.equal(h.nodes.get('status-box').classList.contains('error'), true, 'The affected copy is unverified, not a green success');
  assert.doesNotMatch(h.nodes.get('status-message').textContent, /\d+ portable files verified\./);
}

function bindingReview() {
  return {migration_id:'11111111-1111-4111-8111-111111111111', checkpoint:'a'.repeat(64), complete:true,
    processed_units:1, total_units:1, normalized_records:1, preserved_only_units:0,
    redactions:0, records:[], omissions:[], has_more_records:false};
}

test('same exported copy verifies; raw-source opt-in is bound to the successful export, not the current checkbox', {skip:!python}, async t=>{
  for (const original of [false, true]) {
    const {h, output} = fixture(t); await h.open();
    const chosen = output(original ? 'with-original' : 'without-original'); await h.export(chosen, original);
    h.nodes.get('include-original').checked = !original;
    await h.click('verify-export');
    assert.match(h.nodes.get('status-message').textContent, new RegExp((original ? 3 : 2)+' portable files verified\\.'));
    assert.equal(h.nodes.get('verify-export').hidden, false);
    assert.equal(h.nodes.get('export-location').textContent, chosen.label);
  }
});

test('malformed zero-record exports distinguish metadata-only from explicit original-source copies', {skip:!python}, async t=>{
  for (const original of [false, true]) {
    const {h, output, libraries} = fixture(t, ['A'], true); await h.open();
    assert.equal(libraries.A.review.normalized_records, 0);
    assert.equal(libraries.A.review.omissions_total, 1);
    assert.match(h.nodes.get('migration-export-description').textContent,
      /(?:no|zero|0) (?:normalized |parsed )?(?:conversation|reference|record)/i);
    const chosen = output(original ? 'original-and-metadata' : 'metadata-only'); await h.export(chosen, original);
    const manifest = JSON.parse(fs.readFileSync(path.join(chosen.handle, 'manifest.json')));
    assert.equal(manifest.files.length, original ? 1 : 0);
    assert.equal(fs.existsSync(path.join(chosen.handle, 'original-export.bin')), original);
    assert.equal(fs.readdirSync(chosen.handle).length, original ? 3 : 2);
    if (original) {
      assert.match(h.nodes.get('status-message').textContent, /original.*metadata|metadata.*original/i);
      assert.match(h.nodes.get('status-message').textContent, /no parsed|no conversation/i);
    } else {
      assert.match(h.nodes.get('status-message').textContent, /metadata.*only/i);
      assert.match(h.nodes.get('status-message').textContent, /no conversations/i);
    }
    // A later checkbox change cannot rewrite what was actually saved.
    h.nodes.get('include-original').checked = !original;
    await h.click('verify-export');
    const message = h.nodes.get('status-message').textContent;
    if (original) {
      assert.match(message, /1.*original.*hash/i);
      assert.match(message, /no parsed|no conversation/i);
    } else {
      assert.match(message, /metadata.only/i);
      assert.match(message, /no content.file hashes/i);
      assert.match(message, /not authenticated/i);
      assert.doesNotMatch(message, /0 portable files verified/i);
    }
    assert.equal(h.nodes.get('verify-export').hidden, false);
  }
});

test('valid B substituted at exported A path cannot verify as the selected A copy', {skip:!python}, async t=>{
  const {root, libraries, output, exportLibrary, h} = fixture(t, ['A','B']); await h.open();
  const a = output('portable-A'), b = output('portable-B');
  await h.export(a); exportLibrary('B', b.handle);
  fs.renameSync(a.handle, path.join(root, 'original-A-preserved')); fs.renameSync(b.handle, a.handle);
  const actual = cli(['migrate','verify',a.handle]);
  assert.equal(actual.migration_id, libraries.B.review.migration_id);
  assert.notEqual(actual.checkpoint, libraries.A.review.checkpoint);
  await h.click('verify-export'); assertCleared(h);
  assert.equal(fs.existsSync(path.join(root, 'original-A-preserved', 'manifest.json')), true);
});

test('same identity/checkpoint with a truncated manifest list is not the exported file set', {skip:!python}, async t=>{
  const {libraries, output, h} = fixture(t); await h.open(); const a = output('portable-A'); await h.export(a);
  const manifestPath = path.join(a.handle, 'manifest.json'); const manifest = JSON.parse(fs.readFileSync(manifestPath));
  assert.equal(manifest.files.length, 2); manifest.files.pop(); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const actual = cli(['migrate','verify',a.handle]);
  assert.equal(actual.migration_id, libraries.A.review.migration_id);
  assert.equal(actual.checkpoint, libraries.A.review.checkpoint);
  assert.equal(actual.verified_files, 1, 'CLI verifies listed files without authenticating manifest completeness');
  await h.click('verify-export'); assertCleared(h);
});

test('failed new destination clears prior successful A; cancelling the chooser preserves A', {skip:!python}, async t=>{
  const {root, output, h} = fixture(t); await h.open(); const a = output('portable-A'); await h.export(a);
  await h.export(null); assert.equal(h.nodes.get('export-location').textContent, a.label);
  assert.equal(h.nodes.get('verify-export').hidden, false);
  await h.click('verify-export'); assert.match(h.nodes.get('status-message').textContent, /2 portable files verified\./);
  const b = output('existing-B'); fs.mkdirSync(b.handle); fs.writeFileSync(path.join(b.handle, 'sentinel'), 'Preserve existing files');
  await h.export(b); assertCleared(h, a.label);
  assert.equal(fs.readFileSync(path.join(b.handle, 'sentinel'), 'utf8'), 'Preserve existing files');
  assert.equal(fs.existsSync(path.join(root, 'portable-A', 'manifest.json')), true);
});

test('a chooser error clears selection without starting another export or changing the earlier copy', {skip:!python}, async t=>{
  const {output, h} = fixture(t); await h.open(); const a = output('valid-A'); await h.export(a);
  const snapshot = ()=>fs.readdirSync(a.handle).sort().map(name=>[name, fs.readFileSync(path.join(a.handle, name))]);
  const before = snapshot();
  assert.equal(h.calls.filter(([action])=>action === 'migration-export').length, 1);
  h.choose(new Error('Choose a new destination. Existing files and folders are never overwritten.'));
  await h.click('export-migration'); assertCleared(h, a.label);
  assert.equal(h.calls.filter(([action])=>action === 'migration-export').length, 1,
    'A rejected chooser never returned an output handle for another backend export');
  assert.match(h.nodes.get('status-message').textContent, /destination|location/i);
  assert.match(h.nodes.get('status-message').textContent, /no new export (?:was )?started/i);
  assert.deepEqual(snapshot(), before);
});

test('integrity failure after prior successful verification clears selectable success', {skip:!python}, async t=>{
  const {output, h} = fixture(t); await h.open(); const a = output('portable-A'); await h.export(a);
  await h.click('verify-export'); assert.match(h.nodes.get('status-message').textContent, /2 portable files verified\./);
  const manifest = JSON.parse(fs.readFileSync(path.join(a.handle, 'manifest.json')));
  fs.appendFileSync(path.join(a.handle, manifest.files[0].file), 'tampered');
  assert.throws(()=>cli(['migrate','verify',a.handle]), /digest mismatch/);
  await h.click('verify-export'); assertCleared(h);
});

test('a stale reviewed checkpoint cannot leave an old export selectable after a new attempt', {skip:!python}, async t=>{
  const {libraries, output, h} = fixture(t); await h.open();
  const a = output('portable-A'), b = output('new-B'); await h.export(a);
  const library = libraries.A;
  cli(['migrate','redact','--workspace',library.workspace,'--base-digest',library.review.checkpoint,
    '--record',library.review.records[0].file,'--pointer','/title']);
  await h.export(b); assertCleared(h, a.label);
  assert.match(h.nodes.get('status-message').textContent, /stale|review|checkpoint/i);
  assert.equal(fs.existsSync(b.handle), false);
  assert.equal(fs.existsSync(path.join(a.handle, 'manifest.json')), true);
});

test('expiry after active review and A export rejects selected B without changing the library', {skip:!python}, async t=>{
  const deadline = new Date(Date.now()+20000);
  const {root, libraries, output, h} = fixture(t, ['A'], false, deadline.toISOString());
  await h.open(); const a = output('active-A'), b = output('after-expiry-B'); await h.export(a);
  assert.equal(h.nodes.get('verify-export').hidden, false, 'A was exported while retention permitted it');
  const incomplete = path.join(root, 'planned-but-not-run');
  cli(['migrate','plan',path.join(root, 'A.json'),'--workspace',incomplete,'--provider','generic',
    '--format','generic-json','--expires-at',deadline.toISOString(),'--confirm-long-term-migration']);
  const snapshot = ()=>fs.readdirSync(libraries.A.workspace).sort().map(name=>
    [name, fs.readFileSync(path.join(libraries.A.workspace, name))]);
  const before = snapshot();
  await new Promise(resolve=>setTimeout(resolve, Math.max(0, deadline.getTime()-Date.now()+30)));
  assert.equal(cli(['migrate','review','--workspace',libraries.A.workspace]).expired, true);
  await h.export(b); assertCleared(h, a.label);
  assert.match(h.nodes.get('status-message').textContent, /expir/i);
  assert.equal(fs.existsSync(b.handle), false);
  assert.equal(fs.existsSync(path.join(a.handle, 'manifest.json')), true);
  assert.deepEqual(snapshot(), before);
  await t.test('actual expired incomplete review is read-only, with no resume or percentage recommendation', async()=>{
    const reviewed = cli(['migrate','review','--workspace',incomplete]);
    assert.equal(reviewed.complete, false); assert.equal(reviewed.expired, true);
    const ui = harness(reviewed, ()=>{throw new Error('Read-only inspection must not mutate the library');});
    await ui.open();
    const phase = ui.nodes.get('migration-phase').textContent;
    assert.match(phase, /expired/i); assert.match(phase, /read.only/i);
    assert.doesNotMatch(phase, /resume|100(?:\.0)?%/i);
    assert.equal(ui.nodes.get('progress').hidden, true);
    assert.equal(ui.nodes.get('process-batch').disabled, true);
    assert.equal(ui.nodes.get('export-migration').disabled, true);
    assert.equal(ui.nodes.get('migration-export-panel').hidden, true);
    const checkpoint = fs.readFileSync(path.join(incomplete, 'checkpoint.json'));
    const attempted = path.join(root, 'expired-incomplete-output');
    assert.throws(()=>cli(['migrate','export','--workspace',incomplete,'--base-digest',reviewed.checkpoint,
      '--target','generic','--output',attempted,'--confirm-reviewed']), /incomplete|expired/i);
    assert.equal(fs.existsSync(attempted), false);
    assert.deepEqual(fs.readFileSync(path.join(incomplete, 'checkpoint.json')), checkpoint);
    // Pending integrity verification remains unknown even if prior expiry data exists.
    const pending = harness({...reviewed, verification_pending:true}, ()=>{throw new Error('Unexpected mutation');});
    await pending.open();
    assert.match(pending.nodes.get('migration-phase').textContent, /verifying|not verified/i);
    assert.doesNotMatch(pending.nodes.get('migration-phase').textContent, /100(?:\.0)?%/);
  });
});

test('each expected provenance field is required, including missing verification metadata', async t=>{
  const review = bindingReview();
  for (const changed of [{migration_id:'22222222-2222-4222-8222-222222222222'}, {checkpoint:'b'.repeat(64)},
    {verified_files:0}, {migration_id:undefined}, {checkpoint:undefined}]) {
    await t.test(Object.entries(changed).map(([key, value])=>key+'='+String(value)).join(', '), async()=>{
      const h = harness(review, async action=>action === 'migration-export'
        ? {output_created:true, checkpoint:review.checkpoint, records:1, target_label:'generic'}
        : {migration_id:review.migration_id, checkpoint:review.checkpoint, verified_files:2, ...changed});
      await h.open(); await h.export({handle:'output', label:'Synthetic A'}); await h.click('verify-export'); assertCleared(h);
    });
  }
});

test('known runner cancellation errors clear prior selection and explain uncertain output', async t=>{
  for (const message of [
    'Stopped. Check whether the output was created before retrying; existing files are never overwritten.',
    'The process did not pause within five seconds and was stopped. Resume library to verify the latest completed checkpoint; an interrupted initial snapshot may need a fresh destination.'
  ]) {
    await t.test(message, async()=>{
      const review = bindingReview(); let exporting = 0;
      const h = harness(review, async action=>{
        assert.equal(action, 'migration-export');
        if (exporting++) throw new Error(message);
        return {output_created:true, checkpoint:review.checkpoint, records:1, target_label:'generic'};
      });
      await h.open(); await h.export({handle:'A', label:'Prior A'});
      await h.export({handle:'B', label:'Attempted B'}); assertCleared(h, 'Prior A');
      assert.match(h.nodes.get('status-message').textContent, /stopp|cancel|interrupt/i);
      assert.match(h.nodes.get('status-message').textContent, /incomplete|absent|partial|unconfirmed/i);
      assert.equal(exporting, 2, 'An interrupted export must not retry automatically');
    });
  }
});

test('ordinary filesystem errors with expired and cancelled path components remain generic failures', async()=>{
  const review = bindingReview(); let exporting = 0;
  const h = harness(review, async action=>{
    assert.equal(action, 'migration-export');
    if (exporting++) throw new Error("EACCES: permission denied, mkdir '/synthetic/expired/cancelled/output'");
    return {output_created:true, checkpoint:review.checkpoint, records:1, target_label:'generic'};
  });
  await h.open(); await h.export({handle:'A', label:'Prior A'});
  await h.export({handle:'B', label:'Attempted B'}); assertCleared(h, 'Prior A');
  const message = h.nodes.get('status-message').textContent;
  assert.match(message, /could not be confirmed|could not confirm|failed/i);
  assert.doesNotMatch(message, /expired|cancelled|retention|stopped|interrupted/i);
  assert.doesNotMatch(message, /EACCES|\/synthetic\//);
  assert.equal(exporting, 2);
});

test('an export response must describe the selected reviewed checkpoint and completed file set', async t=>{
  for (const changed of [{checkpoint:'b'.repeat(64)}, {records:2}, {output_created:false}]) {
    await t.test(Object.entries(changed).map(([key, value])=>key+'='+String(value)).join(', '), async()=>{
      const review = bindingReview();
      const h = harness(review, async action=>{
        assert.equal(action, 'migration-export');
        return {output_created:true, checkpoint:review.checkpoint, records:1, target_label:'generic', ...changed};
      });
      await h.open(); await h.export({handle:'output', label:'Synthetic destination'});
      assertCleared(h);
      assert.equal(h.calls.filter(([action])=>action === 'migration-verify').length, 0);
    });
  }
});
