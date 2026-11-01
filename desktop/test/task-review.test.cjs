'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');const {command}=require('../contracts.cjs');const python=require('./python.cjs')();const engine=path.resolve(__dirname,'../../handoff.py');
function harness(inspections){
 const nodes=new Map(),elements=[],calls=[];let chosen={handle:'task',label:'Synthetic saved task'},inspection=0;
 class Element{constructor(tag){this.tagName=tag.toUpperCase();this.disabled=false;this.hidden=false;this.checked=false;this.value='';this.textContent='';this.children=[];this.handlers={};this.className='';this.classList={toggle(){}};elements.push(this);}addEventListener(name,fn){this.handlers[name]=fn;}setAttribute(){}removeAttribute(){}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}}
 const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');for(const m of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g))nodes.set(m[2],new Element(m[1]));
 nodes.get('task-target').value='codex';nodes.get('task-provider').value='claude';nodes.get('domain').value='business';
 const api={status:async()=>({ready:true,python:'3.13'}),onProgress(){},cancel:async()=>{},choose:async()=>chosen,run:async(action,input)=>{calls.push([action,JSON.parse(JSON.stringify(input))]);if(action==='task-inspect'){const result=inspections[Math.min(inspection++,inspections.length-1)];if(result instanceof Error)throw result;return result;}if(action==='task-new')return{task:{handle:'new-task',label:'Newly saved task'}};return{saved:true};}};
 const document={getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),addEventListener(){},querySelectorAll:()=>elements.filter(e=>['BUTTON','INPUT','SELECT','TEXTAREA'].includes(e.tagName))};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../renderer.js'),'utf8'),{document,window:{handoff:api}});
 const click=id=>nodes.get(id).handlers.click();
 return{nodes,calls,api,click,choose:value=>{chosen=value;},open:()=>click('open-task'),submit:()=>nodes.get('task-form').handlers.submit({preventDefault(){}}),confirm:()=>{nodes.get('confirm-task-reviewed').checked=true;nodes.get('confirm-task-reviewed').handlers.change();},pages:async()=>{const result=[nodes.get('task-content').textContent];while(!nodes.get('task-page-next').disabled){await click('task-page-next');result.push(nodes.get('task-content').textContent);}return result;}};
}
function snapshot(bundle,digest='a'.repeat(64)){return{id:bundle.id,revision:bundle.revision,digest,expiration:'no-expiration',bundle};}
function invoke(args){const r=spawnSync(python,['-X','utf8','-E','-s','-B',engine,...args],{encoding:'utf8',maxBuffer:5*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('task IPC opts into complete inspection and requires reviewed exact digest',()=>{
 const resolve=(handle,kind)=>{assert.equal(handle,kind==='task'?'t':'o');return kind==='task'?'/local/task.json':'/local/ref.md';};
 assert.deepEqual(command('task-inspect',{task:'t'},resolve),['inspect','/local/task.json','--include-content']);
 assert.deepEqual(command('task-export',{task:'t',target:'codex',output:'o',digest:'a'.repeat(64)},resolve),['export','/local/task.json','--provider','codex','--output','/local/ref.md','--expected-digest','a'.repeat(64)]);
 for(const digest of [undefined,'A'.repeat(64),'a'.repeat(63),'a'.repeat(64)+'\n'])assert.throws(()=>command('task-export',{task:'t',target:'codex',output:'o',digest},resolve),/Review/);
 assert.throws(()=>command('task-export',{task:'t',target:'codex',output:'o',digest:'a'.repeat(64),content:'fake'},resolve),/Unexpected/);
});
test('real validated v1 and v2 snapshots preserve all fields and never populate creation form', {skip:!python}, async()=>{
 for(const file of ['example.json','business-task.json']){
  const input=path.resolve(__dirname,'../../examples',file);const actual=invoke(['inspect',input,'--include-content']);const original=JSON.parse(fs.readFileSync(input));const h=harness([actual]);h.nodes.get('goal').value='UNSAVED unrelated draft';h.nodes.get('context').value='Never export this draft';await h.open();
  assert.equal(h.nodes.get('task-create').hidden,true);assert.equal(h.nodes.get('task-review').hidden,false);assert.equal(h.nodes.get('goal').value,'UNSAVED unrelated draft');assert.deepEqual(JSON.parse((await h.pages()).join('')),original);
  if(file==='example.json')for(const field of ['repository','files','tests','artifacts','dirty_changes'])assert.ok(Object.hasOwn(JSON.parse(h.nodes.get('task-content').textContent),field));
  assert.equal(h.nodes.get('export-task').disabled,true);h.confirm();assert.equal(h.nodes.get('export-task').disabled,false);h.choose({handle:'output',label:'Synthetic output'});await h.click('export-task');const call=h.calls.find(([action])=>action==='task-export');assert.deepEqual(call[1],{task:'task',digest:actual.digest,target:'codex',output:'output'});assert.doesNotMatch(JSON.stringify(call),/UNSAVED|Never export/);
 }
});
test('Unicode and literalHTML stay inert; all JSON pages reconstruct near1MiB content without loss',async()=>{
 const bundle=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../examples/business-task.json')));bundle.goal=[];const entry={text:'<img src=x onerror=never_execute> 😀日本語'.repeat(300),status:'inferred'};while(Buffer.byteLength(JSON.stringify(bundle))+Buffer.byteLength(JSON.stringify(entry))+1<1048576)bundle.goal.push({...entry});
 assert.ok(Buffer.byteLength(JSON.stringify(bundle))>1000000);assert.ok(Buffer.byteLength(JSON.stringify(bundle))<1048576);
 let inspected=snapshot(bundle);if(python){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'handoff-task-unicode-')));try{const file=path.join(root,'task.json');fs.writeFileSync(file,JSON.stringify(bundle));inspected=invoke(['inspect',file,'--include-content']);}finally{fs.rmSync(root,{recursive:true,force:true});}}
 const h=harness([inspected]);await h.open();assert.match(h.nodes.get('task-goal').textContent,/<img/);assert.equal(h.nodes.get('task-goal').children.length,0);assert.ok(Buffer.byteLength(h.nodes.get('task-goal').textContent)<=16384);assert.match(h.nodes.get('task-summary-limit').textContent,/16 KiB/);
 const pages=await h.pages();assert.ok(pages.length>2);for(const page of pages){assert.ok(Buffer.byteLength(page)<=65536);assert.doesNotMatch(page,/\uD83D(?![\uDC00-\uDFFF])/u);}assert.equal(pages.join(''),JSON.stringify(inspected.bundle));assert.deepEqual(JSON.parse(pages.join('')),bundle);assert.match(h.nodes.get('task-page-label').textContent,new RegExp('of '+pages.length));
 await h.click('task-page-next');assert.equal(h.nodes.get('task-content').textContent,pages.at(-1));await h.open();assert.match(h.nodes.get('task-page-label').textContent,/Data page 1/);assert.equal(h.nodes.get('confirm-task-reviewed').checked,false);
});
test('open cancellation, failed inspection, createanother and oversized snapshot clear reviewed export state',async()=>{
 const bundle=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../examples/business-task.json')));const h=harness([snapshot(bundle),new Error('Malformed saved file')]);await h.open();h.confirm();h.choose(null);await h.open();assert.equal(h.nodes.get('task-review').hidden,true);assert.equal(h.nodes.get('task-content').textContent,'');assert.equal(h.nodes.get('export-task').disabled,true);await h.click('export-task');assert.equal(h.calls.filter(([a])=>a==='task-export').length,0);
 h.choose({handle:'task',label:'Bad task'});await h.open();assert.match(h.nodes.get('status-message').textContent,/Malformed/);assert.equal(h.nodes.get('task-file').textContent,'');assert.equal(h.nodes.get('task-review').hidden,true);
 const good=harness([snapshot(bundle)]);await good.open();good.confirm();await good.click('new-task');assert.equal(good.nodes.get('task-create').hidden,false);assert.equal(good.nodes.get('task-content').textContent,'');assert.equal(good.nodes.get('confirm-task-reviewed').checked,false);assert.equal(good.nodes.get('export-task').disabled,true);
 const large=harness([snapshot({...bundle,context:[{text:'x'.repeat(1048576),status:'inferred'}]})]);await large.open();assert.equal(large.nodes.get('task-review').hidden,true);assert.match(large.nodes.get('status-message').textContent,/1 MiB/);
});
test('new tasks inspect the exact saved handle; cancelled saves and stale exports require fresh review',async()=>{
 const bundle=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../examples/business-task.json')));const h=harness([snapshot(bundle)]);h.nodes.get('goal').value='New goal';await h.submit();assert.deepEqual(h.calls.map(([a])=>a),['task-new','task-inspect']);assert.deepEqual(h.calls[1][1],{task:'new-task'});assert.equal(h.nodes.get('task-file').textContent,'Newly saved task');assert.equal(h.nodes.get('confirm-task-reviewed').checked,false);
 h.confirm();let reject;const run=h.api.run;h.api.run=async(action,input)=>action==='task-export'?new Promise((_,r)=>{reject=r;}):run(action,input);const pending=h.click('export-task');await Promise.resolve();await Promise.resolve();await h.click('export-task');reject(new Error('reviewed digest changed'));await pending;
 assert.match(h.nodes.get('status-message').textContent,/Reopen and review/);assert.equal(h.nodes.get('task-review').hidden,true);assert.equal(h.nodes.get('export-task').disabled,true);assert.equal(h.nodes.get('task-content').textContent,'');
 h.choose(null);await h.submit();assert.equal(h.nodes.get('task-create').hidden,false);assert.match(h.nodes.get('status-message').textContent,/Save cancelled/);
});
test('expired Task Hand Off is informational and confirmed export remains available; export cancellation is safe',async()=>{
 const bundle=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../examples/business-task.json')));const h=harness([{...snapshot(bundle),expiration:'expired'}]);await h.open();assert.match(h.nodes.get('task-expiration').textContent,/expired.*informational/);h.confirm();assert.equal(h.nodes.get('export-task').disabled,false);h.choose(null);await h.click('export-task');assert.equal(h.calls.filter(([a])=>a==='task-export').length,0);assert.equal(h.nodes.get('task-review').hidden,false);assert.match(h.nodes.get('status-message').textContent,/Export cancelled/);
});

test('actual digest-bound desktop export rejects changed source before output mutation',{skip:!python},()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'handoff-task-desktop-export-')));try{
  const file=path.join(root,'task.json'),output=path.join(root,'reference.md');fs.copyFileSync(path.resolve(__dirname,'../../examples/business-task.json'),file);const inspected=invoke(command('task-inspect',{task:'task'},()=>file));const bundle=JSON.parse(fs.readFileSync(file));bundle.goal[0].text='Changed after review';fs.writeFileSync(file,JSON.stringify(bundle));
  const args=command('task-export',{task:'task',output:'output',target:'codex',digest:inspected.digest},(_,kind)=>kind==='task'?file:output);
  let r=spawnSync(python,['-X','utf8','-E','-s','-B',engine,...args],{encoding:'utf8'});assert.equal(r.status,2);assert.equal(fs.existsSync(output),false);
  fs.writeFileSync(output,'Keep existing output');r=spawnSync(python,['-X','utf8','-E','-s','-B',engine,...args],{encoding:'utf8'});assert.equal(r.status,2);assert.equal(fs.readFileSync(output,'utf8'),'Keep existing output');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
