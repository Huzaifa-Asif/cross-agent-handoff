'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const launcher = path.resolve(__dirname, '../bin/handoff.cjs');
const run = (args, env = {}) => spawnSync(process.execPath, [launcher, ...args], {encoding:'utf8', env:{...process.env, ...env}, timeout:20000});
test('reports version without requiring Python', () => {
  assert.match(run(['--version'], {HANDOFF_PYTHON:'/missing-python'}).stdout, /1\.0\.0/);
});
test('missing Python fails clearly without install activity', () => {
  const p=run(['--help'], {HANDOFF_PYTHON:'/missing-python'});
  assert.equal(p.status, 2);
  assert.match(p.stderr, /No runtime was downloaded/);
});
test('npx-compatible CLI preserves literal context without shell execution', () => {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-npm-')));
  try {
    const output=path.join(root, 'business.json');
    const payload='$(touch NEVER_RUN) `echo INERT` ; <script>alert(1)</script>';
    const result=run(['new','--goal','Plan a launch','--provider','claude','--domain','marketing','--context',payload,'--output',output]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(output)).context[0].text,payload);
    assert.equal(fs.existsSync(path.resolve('NEVER_RUN')),false);
    const check=run(['validate',output]);
    assert.equal(check.status,0,check.stderr);
  } finally {fs.rmSync(root,{recursive:true});}
});
test('Node launcher forwards termination, waits for durable pause, and resumes automatically', async () => {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'handoff-node-pause-')));
  try {
    const source=path.join(root,'history.json'), workspace=path.join(root,'library');
    const records=Array.from({length:1000},(_,i)=>({id:String(i),messages:[{role:'user',text:'Synthetic operations '+i+' '+'.'.repeat(1500)}]}));
    fs.writeFileSync(source,JSON.stringify(records));
    const planned=run(['migrate','plan',source,'--workspace',workspace,'--provider','generic','--format','generic-json','--confirm-long-term-migration']);
    assert.equal(planned.status,0,planned.stderr);
    const checkpoint=JSON.parse(planned.stdout).checkpoint;
    const args=['migrate','run','--workspace',workspace,'--base-digest',checkpoint,'--max-records','100'];
    const child=spawn(process.execPath,[launcher,...args],{stdio:['ignore','pipe','pipe']});
    let output='',sent=false;
    child.stdout.setEncoding('utf8');child.stdout.on('data',part=>output+=part);
    const lines=readline.createInterface({input:child.stderr});
    lines.on('line',line=>{
      const event=JSON.parse(line);
      if (!sent && event.processed_records>=50) {sent=true;child.kill('SIGTERM');}
    });
    const timeout=setTimeout(()=>child.kill('SIGKILL'),20000);
    const status=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});
    clearTimeout(timeout);lines.close();
    assert.equal(status,130);
    const paused=JSON.parse(output);assert.equal(paused.paused,true);assert.ok(paused.normalized_records<1000);
    const resumed=run(['migrate','run','--workspace',workspace,'--base-digest',paused.checkpoint,'--max-records','100']);
    assert.equal(resumed.status,0,resumed.stderr);
    const completed=JSON.parse(resumed.stdout);assert.equal(completed.complete,true);assert.equal(completed.normalized_records,1000);
    const reviewed=run(['migrate','review','--workspace',workspace,'--limit','1000']);
    const rows=JSON.parse(reviewed.stdout).records;
    assert.equal(new Set(rows.map(row=>row.file)).size,1000);
    rows.forEach((row,i)=>assert.equal(JSON.parse(fs.readFileSync(path.join(workspace,row.file))).id,String(i)));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
