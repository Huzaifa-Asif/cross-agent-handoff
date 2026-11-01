'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sanitizeProgress}=require('../progress.cjs');
const {startProcess}=require('../runner.cjs');
const sample={event:'migration-progress',phase:'processing',batch_number:1,checkpoint:'a'.repeat(64),processed_units:0,total_units:2,processed_records:20,total_records:null,progress_percent:null,omitted_units:0,complete:false,paused:false};
test('progress drops arbitrary imported fields and never gives false completion percentages',()=>{
 const safe=sanitizeProgress({...sample,content:'secret',command:'never',progress_percent:100});
 assert.equal(safe.content,undefined);assert.equal(safe.command,undefined);assert.equal(safe.progress_percent,null);assert.equal(safe.total_records,null);
 assert.equal(sanitizeProgress({...sample,phase:'complete',complete:true,total_records:20,progress_percent:100}).progress_percent,100);
 for(const phase of ['complete-with-omissions','error','paused','processing'])assert.equal(sanitizeProgress({...sample,phase,complete:true,progress_percent:100}).progress_percent,null);
 assert.equal(sanitizeProgress({...sample,phase:'complete',complete:true,omitted_units:1,progress_percent:100}).progress_percent,null);
 assert.equal(sanitizeProgress({...sample,phase:'<script>'}),null);
 assert.equal(sanitizeProgress({...sample,checkpoint:'x',processed_records:-1}).checkpoint,undefined);
});
test('streaming process decodes split Unicode, sanitizes progress and does not accumulate progress logs',async()=>{
 const events=[];
 const script=`const b=Buffer.from('日本語');process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));process.stderr.write(JSON.stringify(${JSON.stringify({...sample,unknown:'never'})})+'\\n');},15);`;
 const result=startProcess(process.execPath,['-e',script],{onProgress:event=>events.push(event)});
 assert.equal(await result.promise,'日本語');assert.equal(events.length,1);assert.equal(events[0].unknown,undefined);
});
test('pause waits for graceful exit130 and retains the emitted checkpoint',{skip:process.platform==='win32'},async()=>{
 let job;const events=[];
 const script=`process.on('SIGTERM',()=>{const d={paused:true,checkpoint:'${'b'.repeat(64)}'};process.stdout.write(JSON.stringify(d));process.exit(130);});process.stderr.write(JSON.stringify(${JSON.stringify(sample)})+'\\n');setInterval(()=>{},1000);`;
 job=startProcess(process.execPath,['-e',script],{allowPause:true,onProgress:event=>{events.push(event);job.cancel();}});
 const result=JSON.parse(await job.promise);assert.equal(result.paused,true);assert.equal(result.checkpoint,'b'.repeat(64));assert.equal(events.length,1);
});
test('unresponsive own child is killed after a bounded grace interval',{skip:process.platform==='win32'},async()=>{
 let job;
 const script=`process.on('SIGTERM',()=>{});process.stderr.write(JSON.stringify(${JSON.stringify(sample)})+'\\n');setInterval(()=>{},1000);`;
 job=startProcess(process.execPath,['-e',script],{allowPause:true,killGraceMs:50,onProgress:()=>job.cancel()});
 await assert.rejects(job.promise,/did not pause/);
 assert.equal(job.process.exitCode,null);assert.equal(job.process.signalCode,'SIGKILL');
});
test('bounded output stops only its child and returns a clear error',async()=>{
 const job=startProcess(process.execPath,['-e',"process.stdout.write('x'.repeat(20000));setInterval(()=>{},1000)"],{outputLimit:1024,killGraceMs:50});
 await assert.rejects(job.promise,/display limit/);
});
test('initial snapshot pause is distinguished from a resumable conversation checkpoint',async()=>{
 const result={paused:true,planning_cancelled:true,checkpoint:null,workspace_may_be_incomplete:true};
 const job=startProcess(process.execPath,['-e',`process.stdout.write(JSON.stringify(${JSON.stringify(result)}));process.exit(130)`],{allowPause:true});
 assert.deepEqual(JSON.parse(await job.promise),result);
});
test('real shared engine auto-batches, pauses and resumes without duplicate or lost records',async()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
 const python=require('./python.cjs')();
 assert.ok(python,'A supported Python runtime is required for desktop contract tests.');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'handoff-auto-desktop-'))),engine=path.resolve(__dirname,'../../handoff.py');
 const source=path.join(root,'source.json'),workspace=path.join(root,'library');
 const count=800,records=Array.from({length:count},(_,i)=>({id:`c${i}`,title:`Task ${i}`,messages:[{role:'user',timestamp:'2026-11-01T00:00:00Z',text:`Literal ${i} <script>data only</script> ${'x'.repeat(128)}`}]}));
 fs.writeFileSync(source,JSON.stringify(records));
 const invoke=args=>{const p=spawnSync(python,['-E','-s','-B',engine,...args],{encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);};
 try{
  const plan=invoke(['migrate','plan',source,'--workspace',workspace,'--provider','generic','--format','generic-json','--confirm-long-term-migration']);
  const events=[];let job;
  job=startProcess(python,['-E','-s','-B',engine,'migrate','run','--workspace',workspace,'--base-digest',plan.checkpoint,'--max-records','25'],{allowPause:true,onProgress:event=>{events.push(event);if(event.phase==='batch-complete'&&event.processed_records>=25)job.cancel();}});
  const paused=JSON.parse(await job.promise);assert.equal(paused.paused,true);assert.ok(paused.normalized_records>0&&paused.normalized_records<count);assert.ok(events.some(event=>event.checkpoint));
  const resumedEvents=[];const resume=startProcess(python,['-E','-s','-B',engine,'migrate','run','--workspace',workspace,'--base-digest',paused.checkpoint,'--max-records','25'],{allowPause:true,onProgress:event=>resumedEvents.push(event)});
  const complete=JSON.parse(await resume.promise);assert.equal(complete.complete,true);assert.equal(complete.normalized_records,count);assert.equal(resumedEvents.at(-1).phase,'complete');assert.equal(resumedEvents.at(-1).progress_percent,100);
  const checkpoint=JSON.parse(fs.readFileSync(path.join(workspace,'checkpoint.json'))).data;assert.equal(new Set(checkpoint.records.map(r=>r.file)).size,count);
  const values=checkpoint.records.map(item=>JSON.parse(fs.readFileSync(path.join(workspace,item.file))));
  assert.deepEqual(values.map(record=>record.id),records.map(record=>record.id));assert.deepEqual(values.map(record=>record.messages[0].text),records.map(record=>record.messages[0].text));
  const repeated=invoke(['migrate','run','--workspace',workspace,'--base-digest',complete.checkpoint]);assert.equal(repeated.normalized_records,count);assert.equal(repeated.checkpoint,complete.checkpoint);
  const stale=spawnSync(python,['-B',engine,'migrate','run','--workspace',workspace,'--base-digest',plan.checkpoint],{encoding:'utf8'});assert.equal(stale.status,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('an immediate pause waits for engine handler readiness instead of killing startup',{skip:process.platform==='win32'},async()=>{
 const result={paused:true,checkpoint:'d'.repeat(64)};
 const script=`setTimeout(()=>{process.on('SIGTERM',()=>{process.stdout.write(JSON.stringify(${JSON.stringify(result)}));process.exit(130);});process.stderr.write(JSON.stringify(${JSON.stringify(sample)})+'\\n');setInterval(()=>{},1000);},100);`;
 const job=startProcess(process.execPath,['-e',script],{allowPause:true});job.cancel();assert.deepEqual(JSON.parse(await job.promise),result);
});
test('a pause racing a completed event allows its final result to exit normally',async()=>{
 const done={...sample,phase:'complete',complete:true,total_records:20,progress_percent:100};let job;
 const script=`process.stderr.write(JSON.stringify(${JSON.stringify(done)})+'\\n');setTimeout(()=>process.stdout.write('{"complete":true}'),50);`;
 job=startProcess(process.execPath,['-e',script],{allowPause:true,onProgress:()=>job.cancel()});assert.equal(JSON.parse(await job.promise).complete,true);assert.equal(job.process.signalCode,null);
});

test('record omissions and source-data notices stay distinct and cannot claim full coverage',()=>{
 const counts={record_omissions:2,missing_source_fields:3,intentional_redactions:1,reference_notices:4};
 const safe=sanitizeProgress({...sample,...counts,phase:'complete-with-omissions',complete:true,total_records:20,progress_percent:100});
 for(const [key,count] of Object.entries(counts))assert.equal(safe[key],count);
 assert.equal(safe.omitted_units,0);assert.equal(safe.total_records,20);assert.equal(safe.progress_percent,null);
 for(const key of Object.keys(counts)){
  assert.equal(sanitizeProgress({...sample,[key]:1,phase:'complete',complete:true,progress_percent:100}).progress_percent,null);
  assert.equal(sanitizeProgress({...sample,[key]:'<untrusted>'})[key],undefined);
 }
 const notices=sanitizeProgress({...sample,phase:'complete-with-notices',missing_source_fields:1,complete:true,total_records:20,progress_percent:100});
 assert.equal(notices.phase,'complete-with-notices');assert.equal(notices.record_omissions,undefined);assert.equal(notices.progress_percent,null);
});

test('notice-only completion is delivered immediately and a late pause does not signal a finished worker',async()=>{
 const done={...sample,phase:'complete-with-notices',complete:true,total_records:20,progress_percent:null,missing_source_fields:1};let job;const phases=[];
 const script=`process.stderr.write(JSON.stringify(${JSON.stringify(sample)})+'\\n');setTimeout(()=>{process.stderr.write(JSON.stringify(${JSON.stringify(done)})+'\\n');setTimeout(()=>process.stdout.write('{"complete":true}'),50);},10);`;
 job=startProcess(process.execPath,['-e',script],{allowPause:true,onProgress:event=>{phases.push(event.phase);if(event.phase==='complete-with-notices')job.cancel();}});
 assert.equal(JSON.parse(await job.promise).complete,true);assert.ok(phases.includes('complete-with-notices'));assert.equal(job.process.signalCode,null);
});

test('verification-pending events preserve the flag and suppress unverified findings and success',()=>{
 const safe=sanitizeProgress({...sample,phase:'complete',complete:true,verification_pending:true,progress_percent:100,record_omissions:0,omitted_units:0});
 assert.equal(safe.verification_pending,true);assert.equal(safe.complete,false);assert.equal(safe.progress_percent,null);assert.equal(safe.record_omissions,undefined);assert.equal(safe.omitted_units,undefined);
 assert.equal(sanitizeProgress({...sample,verification_pending:'true'}).verification_pending,undefined);
});
