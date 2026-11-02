'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {command} = require('../contracts.cjs');
const python = require('./python.cjs')();
const engine = path.resolve(__dirname, '../../handoff.py');
function invoke(args) {
  const result = spawnSync(python, ['-E', '-s', '-B', engine, ...args], {encoding:'utf8', timeout:20000});
  assert.equal(result.status, 0, result.stderr); return result.stdout ? JSON.parse(result.stdout) : {};
}
test('IPC actions reject arbitrary paths, operations, unknown fields and missing explicit confirmations', () => {
  const resolve = () => {throw new Error('unknown handle');};
  assert.throws(() => command('shell', {}, resolve), /Unsupported/);
  assert.throws(() => command('task-inspect', {task:'/etc/passwd'}, resolve), /unknown handle/);
  assert.throws(() => command('migration-plan', {confirmed:false}, resolve), /Confirm/);
  assert.throws(() => command('migration-export', {confirmed:false}, resolve), /Review/);
  assert.throws(() => command('task-inspect', {task:'valid', extra:'no'}, resolve), /Unexpected/);
  assert.throws(() => command('migration-run', {workspace:'valid', checkpoint:'a\n'}, () => '/tmp/valid'), /Review/);
});
test('literal untrusted text remains one argument and does not execute a shell', () => {
  const args = command('task-new', {goal:'$(touch PWNED); <script>alert(1)</script>', context:'Quotes " and \n unicode 日本語', preference:'Keep provenance', provider:'claude', domain:'business', output:'chosen'}, () => '/private/tmp/task.json');
  assert.equal(args[2], '$(touch PWNED); <script>alert(1)</script>');
  assert.equal(args.filter(a => a === '--context').length, 1);
  assert.equal(args.filter(a => a === '--preference').length, 1);
});
test('packaged renderer has restrictive CSP and no HTML evaluation or remote resources', () => {
  const html = fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
  const renderer = fs.readFileSync(path.resolve(__dirname,'../renderer.js'),'utf8');
  const main = fs.readFileSync(path.resolve(__dirname,'../main.cjs'),'utf8');
  assert.match(html, /connect-src 'none'/); assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /https?:\/\//); assert.doesNotMatch(renderer, /innerHTML|outerHTML|eval\(|new Function|fetch\(/);
  assert.match(fs.readFileSync(path.resolve(__dirname,'../runner.cjs'),'utf8'), /shell:false/);
  for (const marker of ['contextIsolation: true','sandbox: true','nodeIntegration: false','assertSender(event)','setPermissionRequestHandler','will-navigate','setWindowOpenHandler']) assert.ok(main.includes(marker),marker);
});
test('business task and migration/review/export/redaction journeys use the shared engine', {skip:!python}, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'handoff-desktop-test-')));
  try {
    const paths = new Map();
    const chosen = (id, kind) => {const item=paths.get(id);assert.equal(item.kind,kind);return item.path;};
    paths.set('task-output',{path:path.join(root,'task.json'),kind:'task-output'});
    invoke(command('task-new',{goal:'Prepare our marketing launch',context:'Budget is unapproved. $(touch PWNED)',preference:'Short action lists',provider:'claude',domain:'marketing',output:'task-output'},chosen));
    paths.set('task',{path:path.join(root,'task.json'),kind:'task'});
    const task=JSON.parse(fs.readFileSync(paths.get('task').path));assert.equal(task.repository,undefined);assert.equal(task.preferences[0].text,'Short action lists');
    assert.equal(invoke(command('task-inspect',{task:'task'},chosen)).revision,1);
    const raw=path.join(root,'export.json');fs.writeFileSync(raw,JSON.stringify([{uuid:'synthetic-1',name:'Operations',created_at:'2026-11-01T00:00:00Z',chat_messages:[{uuid:'m1',sender:'human',text:'<script>not executable</script>',created_at:'2026-11-01T00:00:00Z'}]}]));
    paths.set('source',{path:raw,kind:'source'});paths.set('workspace',{path:path.join(root,'library'),kind:'workspace'});
    let result=invoke(command('migration-plan',{source:'source',workspace:'workspace',provider:'claude',format:'claude-json',expiresAt:'',confirmed:true},chosen));
    result=invoke(command('migration-run',{workspace:'workspace',checkpoint:result.checkpoint},chosen));assert.equal(result.complete,true);
    result=invoke(command('migration-review',{workspace:'workspace'},chosen));assert.equal(result.normalized_records,1);
    const file=result.records[0].file; const record=invoke(command('migration-show',{workspace:'workspace',record:file},chosen));assert.equal(record.messages[0].text,'<script>not executable</script>');
    result=invoke(command('migration-redact',{workspace:'workspace',checkpoint:result.checkpoint,record:file,pointer:'/messages/0/text'},chosen));
    paths.set('output',{path:path.join(root,'portable'),kind:'export-output'});
    invoke(command('migration-export',{workspace:'workspace',checkpoint:result.checkpoint,target:'codex',output:'output',confirmed:true},chosen));
    assert.ok(invoke(command('migration-verify',{output:'output'},chosen)).verified_files>=2);
    assert.equal(fs.existsSync(path.join(root,'PWNED')),false);assert.equal(fs.existsSync(path.join(root,'portable/original-export.bin')),false);
    const files=fs.readdirSync(path.join(root,'portable'));const portable=JSON.parse(fs.readFileSync(path.join(root,'portable',files.find(n=>n.endsWith('.json')&&n!=='manifest.json'))));assert.equal(portable.messages[0].text,'[REDACTED]');
    const stale=spawnSync(python,['-B',engine,'migrate','run','--workspace',paths.get('workspace').path,'--base-digest','0'.repeat(64)],{encoding:'utf8'});assert.equal(stale.status,2);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('portable original source requires an explicit boolean and review confirmation', () => {
  const input={workspace:'w',checkpoint:'a'.repeat(64),target:'codex',output:'o',confirmed:true};
  assert.equal(command('migration-export',input,()=>'/selected').includes('--include-original-source'),false);
  assert.equal(command('migration-export',{...input,includeOriginal:true},()=>'/selected').includes('--include-original-source'),true);
  assert.throws(()=>command('migration-export',{...input,includeOriginal:'true'},()=>'/selected'),/Invalid/);
  assert.throws(()=>command('migration-export',{...input,includeOriginal:true,confirmed:false},()=>'/selected'),/Review/);
});
test('review pagination and local search remain bounded allowlisted arguments', () => {
  assert.deepEqual(command('migration-review',{workspace:'w',offset:100},()=>'/selected'),['migrate','review','--workspace','/selected','--offset','100','--limit','100']);
  assert.throws(()=>command('migration-review',{workspace:'w',offset:-1},()=>'/selected'),/Invalid/);
  assert.deepEqual(command('migration-search',{workspace:'w',query:'$(touch never)'},()=>'/selected'),['migrate','search','--workspace','/selected','--query','$(touch never)','--limit','20']);
});
test('renderer clears stale exports, unredacted previews and search when changing libraries', async () => {
  const vm=require('node:vm'); const nodes=new Map(); const elements=[];
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.disabled=false;this.hidden=false;this.checked=false;this.value='';this.textContent='';this.children=[];this.handlers={};this.className='';this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};elements.push(this);}
    addEventListener(name,fn){this.handlers[name]=fn;}
    setAttribute(){} removeAttribute(){} append(...items){this.children.push(...items);} replaceChildren(...items){this.children=items;}
  }
  const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
  for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)) nodes.set(match[2],new Element(match[1]));
  const libraries=['A','B']; let progressListener,finishRun,runCalls=0,cancelCalls=0,bRecords=1,bCheckpoint='b'.repeat(64);
  const library=name=>({migration_id:name==='A'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222',checkpoint:name==='A'?'a'.repeat(64):bCheckpoint,processed_units:name==='A'?1:0,total_units:1,normalized_records:name==='A'?1:bRecords,preserved_only_units:0,redactions:0,complete:name==='A',record_offset:0,has_more_records:false,omissions:[],records:[{file:'record-00000-00000.json',kind:'conversation',title:name,messages:1,omissions:[]}]});
  const api={onProgress:callback=>{progressListener=callback;return()=>{};},cancel:async()=>{cancelCalls++;},status:async()=>({ready:true,version:'1',python:'3.14'}),choose:async kind=>kind==='workspace'?{handle:libraries.shift(),label:'library'}:{handle:'output',label:'old-export'},run:async(action,input)=>{
    if(action==='migration-run'){runCalls++;return new Promise(resolve=>{finishRun=resolve;});}
    if(action==='migration-review')return library(input.workspace);
    if(action==='migration-export')return{output_created:true,checkpoint:library(input.workspace).checkpoint,records:library(input.workspace).normalized_records,target_label:input.target};
    if(action==='migration-search')return{checkpoint:'a'.repeat(64),matched_records:1,results:[{file:'record-00000-00000.json',preview:'UNREDACTED A'}]};
    if(action==='migration-show')return{messages:[{text:'UNREDACTED A'}]};
    return{};
  }};
  const documentHandlers={}; const document={addEventListener:(name,fn)=>{documentHandlers[name]=fn;},getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),querySelectorAll:selector=>elements.filter(e=>selector==='.record-item'?e.className==='record-item':['BUTTON','INPUT','SELECT','TEXTAREA'].includes(e.tagName))};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../renderer.js'),'utf8'),{document,window:{handoff:api}});
  const click=id=>nodes.get(id).handlers.click();
  await click('resume-library');
  nodes.get('library-query').value='A';await click('search-library');
  const searchButton=nodes.get('search-results').children[0].children[0];await searchButton.handlers.click();
  nodes.get('confirm-reviewed').checked=true;nodes.get('include-original').checked=true;nodes.get('migration-target').value='codex';await click('export-migration');
  assert.equal(nodes.get('verify-export').hidden,false);assert.equal(nodes.get('export-location').textContent,'old-export');assert.match(nodes.get('record-content').textContent,/UNREDACTED/);
  await click('resume-library');
  assert.equal(nodes.get('verify-export').hidden,true);assert.equal(nodes.get('export-location').textContent,'');assert.equal(nodes.get('confirm-reviewed').checked,false);assert.equal(nodes.get('include-original').checked,false);
  assert.equal(nodes.get('record-review').hidden,true);assert.equal(nodes.get('record-content').textContent,'');assert.equal(nodes.get('search-results').hidden,true);assert.equal(nodes.get('search-results').children.length,0);assert.equal(nodes.get('library-query').value,'');
  nodes.get('task-screen').hidden=true;nodes.get('migration-screen').hidden=false;
  const first=click('process-batch');await Promise.resolve();await click('process-batch');assert.equal(runCalls,1);
  progressListener({operation:'migration-run',event:'migration-progress',phase:'checking',processed_units:0,total_units:0,processed_records:0,total_records:null,progress_percent:null,checkpoint:'b'.repeat(64),complete:false,omitted_units:0});
  assert.equal(nodes.get('record-count').textContent,'1 / unknown');
  progressListener({operation:'migration-run',event:'migration-progress',phase:'processing',processed_units:0,total_units:1,processed_records:42,total_records:null,progress_percent:null,checkpoint:'c'.repeat(64),complete:false,omitted_units:0});
  assert.equal(nodes.get('record-count').textContent,'42 / unknown');assert.match(nodes.get('migration-phase').textContent,/Processing local records/);
  await click('task-tab');assert.equal(nodes.get('migration-screen').hidden,false);await click('new-migration');assert.equal(nodes.get('migration-work').hidden,false);
  documentHandlers.keydown({key:'Escape',preventDefault(){}});assert.equal(cancelCalls,1);documentHandlers.keydown({key:'Escape',preventDefault(){}});assert.equal(cancelCalls,1);bCheckpoint='c'.repeat(64);bRecords=42;finishRun({...library('B'),paused:true});await first;
  assert.match(nodes.get('status-message').textContent,/Paused safely/);assert.equal(nodes.get('process-batch').textContent,'Resume full migration');assert.equal(nodes.get('process-batch').disabled,false);
  api.run=async()=>({...library('B'),complete:true,record_omissions:2,missing_source_fields:1,intentional_redactions:0,reference_notices:0});
  await click('refresh-review');
  assert.match(nodes.get('migration-phase').textContent,/Finished with omissions/);
  assert.match(nodes.get('migration-phase').textContent,/2 record omissions/);
  assert.match(nodes.get('migration-phase').textContent,/1 missing source fields/);
  assert.doesNotMatch(nodes.get('migration-phase').textContent,/100/);
  assert.equal(nodes.get('progress').hidden,true);assert.equal(nodes.get('record-count').textContent,'42 / 42');
  api.run=async()=>({...library('B'),complete:true,record_omissions:0,missing_source_fields:1,intentional_redactions:1,reference_notices:0});
  await click('refresh-review');
  assert.match(nodes.get('migration-phase').textContent,/Processing finished; review source-data notices/);
  assert.match(nodes.get('migration-phase').textContent,/0 record omissions/);
  assert.match(nodes.get('migration-phase').textContent,/1 intentional redactions/);
  assert.equal(nodes.get('progress').hidden,true);
  api.run=async()=>({...library('B'),complete:true,record_omissions:0,missing_source_fields:0,intentional_redactions:0,reference_notices:0});
  await click('refresh-review');assert.equal(nodes.get('progress').value,100);assert.equal(nodes.get('progress').hidden,false);

});

test('workflow navigation names match visible and accessible product labels',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
 assert.match(html,/<button id="task-tab"[^>]*><span aria-hidden="true">01<\/span> Task Hand Off<\/button>/);
 assert.match(html,/<button id="migration-tab"[^>]*><span aria-hidden="true">02<\/span> Full Migration<\/button>/);
 assert.doesNotMatch(html,/One task|Move my library/);
});
