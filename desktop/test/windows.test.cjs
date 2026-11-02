'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {candidates,environment,discoverPython,resolveWindowsCandidate}=require('../runtime.cjs');
const {startProcess}=require('../runner.cjs');
test('Windows discovery checks engine capability and pins absolute interpreter',async()=>{
 assert.deepEqual(candidates('win32'),[['py','-3.11'],['py','-3'],['python'],['python3']]);
 const calls=[];
 const runtime=await discoverPython('C:\\engine\\handoff.py',async(executable,args)=>{
  calls.push([executable,args]);
  if(calls.length===1)return 'Store alias';
  return JSON.stringify({safe:calls.length>2,version:[3,12,8],executable:'C:\\Python\\python.exe',backend:'windows'});
 },'win32');
 assert.deepEqual(runtime,{executable:'C:\\Python\\python.exe',version:'3.12.8'});
 assert.deepEqual(calls[0][1].slice(0,4),['-3.11','-X','utf8','-E']);
 assert.ok(calls[0][1].includes('C:\\engine\\handoff.py'));
 assert.equal(await discoverPython('engine',async()=>JSON.stringify({safe:true,version:[3,10,9],executable:'C:\\python.exe',backend:'windows'}),'win32'),null);
});
test('Windows environment retains loader paths and excludes secrets',()=>{
 const env=environment('win32',{Path:'C:\\Windows',SYSTEMROOT:'C:\\Windows',API_KEY:'secret',PYTHONPATH:'untrusted',NODE_OPTIONS:'untrusted'},'C:\\temp');
 assert.equal(env.PATH,'C:\\Windows');assert.equal(env.SystemRoot,'C:\\Windows');assert.equal(env.PYTHON_MANAGER_AUTOMATIC_INSTALL,'false');
 for(const key of ['API_KEY','PYTHONPATH','NODE_OPTIONS'])assert.equal(env[key],undefined);
});
test('Windows pause sends constant stdin request without SIGTERM',async()=>{
 let job;
 const event={event:'migration-progress',phase:'processing',complete:false};
 const script=`if(process.env.HANDOFF_CANCEL_STDIN!=='1')process.exit(5);process.stdin.once('data',data=>{if(data.toString()!=='pause\\n')process.exit(6);process.stdout.write(JSON.stringify({paused:true,checkpoint:'${'e'.repeat(64)}'}));process.exit(130);});process.stderr.write(JSON.stringify(${JSON.stringify(event)})+'\\n');setInterval(()=>{},1000);`;
 job=startProcess(process.execPath,['-e',script],{platform:'win32',allowPause:true,onProgress:()=>job.cancel()});
 assert.equal(JSON.parse(await job.promise).paused,true);assert.equal(job.process.signalCode,null);
});
test('Windows early pause waits for readiness; completed worker receives no pause',async()=>{
 const event={event:'migration-progress',phase:'checking',complete:false};
 const script=`setTimeout(()=>{process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({paused:true,checkpoint:'${'f'.repeat(64)}'}));process.exit(130);});process.stderr.write(JSON.stringify(${JSON.stringify(event)})+'\\n');},50);setInterval(()=>{},1000);`;
 const job=startProcess(process.execPath,['-e',script],{platform:'win32',allowPause:true});job.cancel();assert.equal(JSON.parse(await job.promise).paused,true);
 let done;const terminal={event:'migration-progress',phase:'complete',complete:true};
 done=startProcess(process.execPath,['-e',`process.stderr.write(JSON.stringify(${JSON.stringify(terminal)})+'\\n');setTimeout(()=>process.stdout.write('{"complete":true}'),20);`],{platform:'win32',allowPause:true,onProgress:()=>done.cancel()});
 assert.equal(JSON.parse(await done.promise).complete,true);assert.equal(done.process.signalCode,null);
});
test('cooperative stdin pauses and resumes real engine without losing records',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const python=require('./python.cjs')();
 assert.ok(python,'Python3.11+ required; HANDOFF_TEST_PYTHON may select its absolute path.');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'handoff-stdin-'))),engine=path.resolve(__dirname,'../../handoff.py'),workspace=path.join(root,'library'),source=path.join(root,'source.json');
 const records=Array.from({length:250},(_,i)=>({id:'stdin-'+i,title:'Synthetic '+i,messages:[{role:'user',timestamp:'2026-11-01T00:00:00Z',text:'Literal 日本語 😀 '+i}]}));
 const invoke=args=>{const r=spawnSync(python,['-X','utf8','-E','-s','-B',engine,...args],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 try {
  fs.writeFileSync(source,JSON.stringify(records));
  const plan=invoke(['migrate','plan',source,'--workspace',workspace,'--provider','generic','--format','generic-json','--confirm-long-term-migration']);
  let job;job=startProcess(python,['-X','utf8','-E','-s','-B',engine,'migrate','run','--workspace',workspace,'--base-digest',plan.checkpoint,'--max-records','10'],{platform:'win32',allowPause:true,onProgress:event=>{if(event.phase==='batch-complete')job.cancel();}});
  const paused=JSON.parse(await job.promise);assert.equal(paused.paused,true);assert.ok(paused.normalized_records>0&&paused.normalized_records<records.length);assert.equal(job.process.signalCode,null);
  const done=invoke(['migrate','run','--workspace',workspace,'--base-digest',paused.checkpoint]);assert.equal(done.normalized_records,records.length);assert.equal(done.complete,true);
  const checkpoint=JSON.parse(fs.readFileSync(path.join(workspace,'checkpoint.json'))).data;
  const actual=checkpoint.records.map(item=>JSON.parse(fs.readFileSync(path.join(workspace,item.file))));assert.deepEqual(actual.map(item=>item.messages[0].text),records.map(item=>item.messages[0].text));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('packaged engine invocation explicitly enables UTF8 despite isolated environment',()=>{
 const fs=require('node:fs'),path=require('node:path');
 assert.match(fs.readFileSync(path.resolve(__dirname,'../main.cjs'),'utf8'),/\['-X', 'utf8', '-E', '-s', '-B', enginePath\(\)/);
});

test('Windows candidate resolution skips Store python aliases and relative PATH entries',()=>{
 const search='relative;C:\\Users\\Synthetic\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Python312';
 assert.equal(resolveWindowsCandidate('python',search,()=>true),'C:\\Python312\\python.exe');
 assert.match(resolveWindowsCandidate('py',search,()=>true),/WindowsApps/);
 assert.equal(resolveWindowsCandidate('python','relative',()=>true),undefined);
});

test('Windows native selections preserve components for backend reparse checks',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.resolve(__dirname,'../main.cjs'),'utf8');
 assert.match(source,/process.platform === 'win32' \? path.resolve\(selected\) : fs.realpathSync.native\(selected\)/);
 assert.match(source,/else selected = process.platform === 'win32' \? path.resolve\(selected\)/);
});

test('Windows discovery never probes unsupported UNC, device or root-relative entries',()=>{
 const unsupported=['\\\\synthetic-server\\share','\\\\?\\C:\\Python','\\\\.\\device','\\Python','C:relative','relative'];
 const calls=[];
 assert.equal(resolveWindowsCandidate('python',[...unsupported,'C:\\Python312'].join(';'),file=>{calls.push(file);return true;}),'C:\\Python312\\python.exe');
 assert.deepEqual(calls,['C:\\Python312\\python.exe']);
 calls.length=0;
 assert.equal(resolveWindowsCandidate('py',unsupported.join(';'),file=>{calls.push(file);return true;}),undefined);
 assert.deepEqual(calls,[]);
 assert.equal(resolveWindowsCandidate('python','c:/Python312',()=>true),'c:\\Python312\\python.exe');
});
