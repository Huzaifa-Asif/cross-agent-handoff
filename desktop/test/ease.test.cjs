'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(options={}){
 const nodes=new Map(),elements=[];let listener;const calls=[];
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.disabled=false;this.hidden=false;this.checked=false;this.value='';this.textContent='';this.children=[];this.handlers={};this.className='';this.classList={toggle(){}};elements.push(this);}
  addEventListener(name,fn){this.handlers[name]=fn;}setAttribute(){}removeAttribute(){}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}
 }
 const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
 for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g))nodes.set(match[2],new Element(match[1]));
 nodes.get('source-provider').value='claude';nodes.get('source-format').value='claude-json';
 const document={getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),addEventListener(){},querySelectorAll:()=>elements.filter(e=>['BUTTON','INPUT','SELECT','TEXTAREA'].includes(e.tagName))};
 const api={onProgress:fn=>{listener=fn;},cancel:async()=>{},status:async()=>({ready:true,python:'3.13',platform:'win32',version:'1'}),choose:async kind=>({handle:kind,label:'synthetic-'+kind}),run:async()=>({...library(),records:[]}),...options};
 const run=api.run;api.run=async(action,input)=>{calls.push([action,input]);return run(action,input);};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../renderer.js'),'utf8'),{document,window:{handoff:api}});
 return{nodes,calls,api,progress:event=>listener(event),click:id=>nodes.get(id).handlers.click(),change:(id,value)=>{nodes.get(id).value=value;nodes.get(id).handlers.change();}};
}
function library(extra={}){return{checkpoint:'a'.repeat(64),processed_units:0,total_units:1,normalized_records:0,preserved_only_units:0,partially_normalized_units:0,redactions:0,complete:false,records:[],omissions:[],has_more_records:false,...extra};}
test('format defaults stop changing after an explicit choice, including repeated provider changes',async()=>{
 const h=harness();h.change('source-provider','generic');assert.equal(h.nodes.get('source-format').value,'documents');
 h.change('source-format','generic-json');for(const provider of ['claude','gemini','grok','claude']){h.change('source-provider',provider);assert.equal(h.nodes.get('source-format').value,'generic-json');}
 assert.match(h.nodes.get('format-choice').textContent,/choice is kept/);assert.match(h.nodes.get('format-guidance').textContent,/Arbitrary JSON/);
 await h.click('new-migration');await h.click('new-migration');h.change('source-provider','cursor');assert.equal(h.nodes.get('source-format').value,'generic-json');
 assert.match(h.nodes.get('provider-guidance').textContent,/verified full-account Cursor parser is not available/);
 h.change('source-format','archive');assert.match(h.nodes.get('format-guidance').textContent,/without parsing/);assert.match(h.nodes.get('format-guidance').textContent,/excludes that original by default/);assert.equal(h.calls.length,0);
});
test('cancelled snapshot explains fresh-folder recovery and repeated clicks do not duplicate work',async()=>{
 let finish,cancels=0;const h=harness({cancel:async()=>{cancels++;},run:async action=>action==='migration-plan'?new Promise(resolve=>{finish=resolve;}):library()});
 await h.click('choose-source');await h.click('choose-workspace');h.nodes.get('confirm-migration').checked=true;
 const pending=h.click('plan-migration');await Promise.resolve();await h.click('plan-migration');assert.equal(h.calls.length,1);
 await h.click('cancel-operation');await h.click('cancel-operation');assert.equal(cancels,1);
 finish({planning_cancelled:true,paused:true,checkpoint:null});await pending;
 assert.match(h.nodes.get('recovery-help').textContent,/before a resumable checkpoint/);assert.match(h.nodes.get('recovery-help').textContent,/fresh library location/);assert.match(h.nodes.get('recovery-help').textContent,/not deleted here/);
});
test('ready empty library says processing has not started; paused and completed states differ',async()=>{
 let current=library();const h=harness({run:async action=>action==='migration-run'?{...current,paused:true}:current});
 await h.click('resume-library');assert.match(h.nodes.get('records').children[0].textContent,/Processing has not started/);assert.doesNotMatch(h.nodes.get('records').children[0].textContent,/preserved-only files/);
 current=library({processed_units:0,normalized_records:1,records:[{file:'record.json',title:'Synthetic',kind:'conversation',messages:1,omissions:[]}]});
 await h.click('process-batch');assert.match(h.nodes.get('recovery-help').textContent,/Paused at a saved checkpoint/);assert.match(h.nodes.get('recovery-help').textContent,/No source re-import/);
 await h.click('resume-library');assert.match(h.nodes.get('recovery-help').textContent,/do not need to select the original/);
 current=library({complete:true,processed_units:1,preserved_only_units:1});await h.click('refresh-review');assert.match(h.nodes.get('records').children[0].textContent,/No conversation records were parsed/);assert.doesNotMatch(h.nodes.get('records').children[0].textContent,/has not started/);
});
test('local setup guidance is useful without a runtime and expired recovery is not overwritten',async()=>{
 const h=harness({status:async()=>({ready:false}),run:async()=>library({expired:true})});await Promise.resolve();await Promise.resolve();
 assert.match(h.nodes.get('setup-help').textContent,/Python 3.11/);assert.match(h.nodes.get('setup-help').textContent,/Nothing is downloaded/);
 await h.click('resume-library');assert.match(h.nodes.get('recovery-help').textContent,/expired/);assert.match(h.nodes.get('status-message').textContent,/expired/);
 const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');assert.match(html,/<details id="local-help"/);assert.match(html,/<summary>Setup &amp; recovery help/);assert.match(html,/aria-describedby="format-guidance format-choice"/);
});

test('expired libraries disable processing and export while leaving review and search available',async()=>{
 for(const complete of [false,true]){
  const h=harness({run:async()=>library({expired:true,complete,processed_units:complete?1:0})});
  await h.click('resume-library');assert.equal(h.nodes.get('process-batch').disabled,true);assert.equal(h.nodes.get('export-migration').disabled,true);
  assert.equal(h.nodes.get('refresh-review').disabled,false);assert.equal(h.nodes.get('search-library').disabled,false);
  assert.match(h.nodes.get('records').children[0].textContent,/expired/);assert.doesNotMatch(h.nodes.get('records').children[0].textContent,/Start or resume/);
 }
});
test('expiry discovered by review after planning or processing keeps its warning',async()=>{
 for(const operation of ['migration-plan','migration-run']){
  const h=harness({run:async action=>action==='migration-review'?library({expired:true}):library()});
  if(operation==='migration-plan'){await h.click('choose-source');await h.click('choose-workspace');h.nodes.get('confirm-migration').checked=true;await h.click('plan-migration');}
  else{await h.click('resume-library');await h.click('process-batch');}
  assert.match(h.nodes.get('status-message').textContent,/expired/);assert.match(h.nodes.get('recovery-help').textContent,/expired/);assert.equal(h.nodes.get('process-batch').disabled,true);
 }
});

test('pause during verification returns promptly without automatic review or stale verified records',async()=>{
 let runs=0;const record={file:'record.json',title:'Previously verified',kind:'conversation',messages:1,omissions:[]};
 const h=harness({run:async action=>{
  if(action==='migration-show')return{messages:[{text:'OLD PREVIEW'}]};
  if(action==='migration-run'){runs++;return runs===1?library({paused:true,verification_pending:true,normalized_records:1}):library({complete:true,processed_units:1,normalized_records:1});}
  return library({records:[record],normalized_records:1,complete:runs>1,processed_units:runs>1?1:0});
 }});
 await h.click('resume-library');await h.nodes.get('records').children[0].children[0].handlers.click();assert.match(h.nodes.get('record-content').textContent,/OLD PREVIEW/);
 const reviewed=h.calls.filter(([action])=>action==='migration-review').length;
 await h.click('process-batch');assert.equal(h.calls.filter(([action])=>action==='migration-review').length,reviewed);
 assert.equal(h.nodes.get('record-review').hidden,true);assert.equal(h.nodes.get('record-content').textContent,'');assert.match(h.nodes.get('records').children[0].textContent,/awaits verification/);assert.doesNotMatch(h.nodes.get('records').children[0].textContent,/Previously verified/);
 assert.match(h.nodes.get('migration-phase').textContent,/Paused while verifying/);assert.doesNotMatch(h.nodes.get('migration-phase').textContent,/0 record omissions|100/);assert.equal(h.nodes.get('opaque-count').textContent,'Not verified');assert.match(h.nodes.get('omissions').textContent,/await verification/);assert.doesNotMatch(h.nodes.get('omissions').textContent,/No export files were skipped/);assert.equal(h.nodes.get('migration-export-panel').hidden,true);assert.equal(h.nodes.get('process-batch').disabled,false);
 await h.click('process-batch');assert.equal(h.calls.filter(([action])=>action==='migration-review').length,reviewed+1);assert.equal(h.nodes.get('records').children[0].children[0].children[0].textContent,'Previously verified');
});
test('verification-pending progress hides stale findings before a pause result arrives',async()=>{
 let finish;const h=harness({run:async action=>action==='migration-run'?new Promise(resolve=>{finish=resolve;}):library({normalized_records:1,records:[{file:'old.json',title:'Old title',kind:'conversation',messages:1,omissions:[]}]})});
 await h.click('resume-library');const pending=h.click('process-batch');await Promise.resolve();
 h.progress({operation:'migration-run',phase:'checking',verification_pending:true,complete:false,progress_percent:null});
 assert.equal(h.nodes.get('opaque-count').textContent,'Not verified');assert.match(h.nodes.get('records').children[0].textContent,/awaits verification/);assert.doesNotMatch(h.nodes.get('migration-phase').textContent,/0 record omissions/);
 h.progress({operation:'migration-run',phase:'processing',verification_pending:false,complete:false,progress_percent:null,processed_records:1,total_records:null,record_omissions:0,missing_source_fields:0,intentional_redactions:0,reference_notices:0});
 assert.match(h.nodes.get('migration-phase').textContent,/Processing local records/);assert.match(h.nodes.get('migration-phase').textContent,/0 record omissions/);
 finish(library({paused:true,verification_pending:true}));await pending;
});

test('explicit refresh verifies a pending library and clears pending recovery text',async()=>{
 const h=harness({run:async action=>action==='migration-run'?library({paused:true,verification_pending:true}):library()});
 await h.click('resume-library');await h.click('process-batch');const reviews=h.calls.filter(([a])=>a==='migration-review').length;
 await h.click('refresh-review');assert.equal(h.calls.filter(([a])=>a==='migration-review').length,reviews+1);assert.match(h.nodes.get('recovery-help').textContent,/findings are verified/);assert.doesNotMatch(h.nodes.get('recovery-help').textContent,/not yet verified/);
});

test('failed verification keeps findings unknown and shows a stopped state',async()=>{
 let rejectRun;const h=harness({run:async action=>action==='migration-run'?new Promise((_resolve,reject)=>{rejectRun=reject;}):library()});
 await h.click('resume-library');const pending=h.click('process-batch');await Promise.resolve();
 h.progress({operation:'migration-run',phase:'checking',verification_pending:true,complete:false,progress_percent:null});rejectRun(new Error('Synthetic verification failed'));await pending;
 assert.match(h.nodes.get('migration-phase').textContent,/Stopped during verification/);assert.equal(h.nodes.get('progress').hidden,true);assert.equal(h.nodes.get('opaque-count').textContent,'Not verified');assert.match(h.nodes.get('status-message').textContent,/Synthetic verification failed/);
});

test('a resumed pending library that fails before progress still shows stopped verification',async()=>{
 let runs=0;const h=harness({run:async action=>{if(action==='migration-run'){if(++runs===1)return library({paused:true,verification_pending:true});throw new Error('Synthetic early failure');}return library();}});
 await h.click('resume-library');await h.click('process-batch');await h.click('process-batch');
 assert.match(h.nodes.get('migration-phase').textContent,/Stopped during verification/);assert.equal(h.nodes.get('progress').hidden,true);assert.equal(h.nodes.get('opaque-count').textContent,'Not verified');
});

test('a fresh plan is ready without an animated processing bar',async()=>{
 const h=harness();await h.click('choose-source');await h.click('choose-workspace');h.nodes.get('confirm-migration').checked=true;await h.click('plan-migration');
 assert.match(h.nodes.get('migration-phase').textContent,/Ready for automatic processing/);assert.equal(h.nodes.get('progress').hidden,true);assert.match(h.nodes.get('records').children[0].textContent,/Processing has not started/);
});
