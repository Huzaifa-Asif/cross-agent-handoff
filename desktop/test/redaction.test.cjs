'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function harness(record,flags={}){
 const nodes=new Map(),elements=[],calls=[];let progress,resolveRedact,revision=0;
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.disabled=false;this.hidden=false;this.checked=false;this.value='';this.textContent='';this.children=[];this.handlers={};this.className='';this.classList={toggle(){}};elements.push(this);}
  addEventListener(name,fn){this.handlers[name]=fn;}setAttribute(){}removeAttribute(){}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}
 }
 const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');for(const m of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g))nodes.set(m[2],new Element(m[1]));
 const data=()=>({checkpoint:(revision?'b':'a').repeat(64),processed_units:1,total_units:1,normalized_records:1,preserved_only_units:0,redactions:revision,complete:true,records:[{file:revision?'redacted-00000001-00000.json':'record-00000-00000.json',title:'Fixture',kind:'conversation',messages:record.messages?.length||0,omissions:[]}],omissions:[],...flags});
 const api={status:async()=>({ready:true,python:'3.13'}),onProgress:fn=>{progress=fn;},cancel:async()=>{},choose:async()=>({handle:'library',label:'Synthetic library'}),run:async(action,input)=>{calls.push([action,input]);if(action==='migration-show')return record;if(action==='migration-redact')return new Promise(resolve=>{resolveRedact=()=>{revision++;resolve(data());};});return data();}};
 const document={getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),addEventListener(){},querySelectorAll:selector=>elements.filter(e=>selector==='.record-item'?e.className==='record-item':['BUTTON','INPUT','SELECT','TEXTAREA'].includes(e.tagName))};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../renderer.js'),'utf8'),{document,window:{handoff:api}});
 const click=id=>nodes.get(id).handlers.click();
 return{nodes,calls,api,progress:event=>progress(event),click,open:async()=>{await click('resume-library');await nodes.get('records').children[0].children[0].handlers.click();},choose:pointer=>{nodes.get('redact-choice').value=pointer;nodes.get('redact-choice').handlers.change();},typed:pointer=>{nodes.get('redact-pointer').value=pointer;nodes.get('redact-pointer').handlers.input();},finish:()=>resolveRedact(),options:()=>nodes.get('redact-choice').children.slice(1)};
}
test('50,000 messages create only20 choices per page and static bounded pointers',async()=>{
 const h=harness({title:'Title',context:null,preferences:null,messages:Array.from({length:50000},(_,i)=>({role:'user',text:'Message '+i}))});await h.open();
 assert.equal(h.options().length,21);assert.equal(h.options().at(-1).value,'/messages/19/text');assert.match(h.nodes.get('redact-page').textContent,/1–20 of 50000/);
 h.choose('/messages/19/text');assert.equal(h.nodes.get('redact-record').disabled,false);await h.click('redact-next');assert.equal(h.nodes.get('redact-pointer').value,'');assert.equal(h.nodes.get('redact-record').disabled,true);assert.equal(h.options()[1].value,'/messages/20/text');assert.equal(h.options().length,21);
 for(let page=1;page<2499;page++)await h.click('redact-next');
 assert.match(h.nodes.get('redact-page').textContent,/49981–50000 of 50000/);assert.equal(h.options().at(-1).value,'/messages/49999/text');assert.equal(h.nodes.get('redact-next').disabled,true);assert.equal(h.options().length,21);
 await h.click('redact-next');assert.equal(h.options().at(-1).value,'/messages/49999/text');
 assert.equal(h.calls.filter(([action])=>action==='migration-redact').length,0);
});
test('maliciousHTML remains inert text and Unicode guided previews stay below8KiB',async()=>{
 const text='<img src=x onerror="globalThis.bad=true">'+ '😀日本語'.repeat(1000);
 const h=harness({title:text,context:{nested:text},preferences:[text],messages:Array.from({length:20},()=>({role:'<script>role</script>',text}))});await h.open();
 const options=h.options();assert.equal(options.length,23);assert.ok(options.every(option=>option.tagName==='OPTION' && option.children.length===0));
 assert.match(options[0].textContent,/<img/);assert.ok(Buffer.byteLength(h.nodes.get('record-content').textContent,'utf8')<=262144+200);assert.match(h.nodes.get('record-content').textContent,/Display limit reached/);for(const option of options)assert.ok(Buffer.byteLength(option.textContent,'utf8')<=256);
 h.choose('/messages/0/text');assert.match(h.nodes.get('redact-selection').textContent,/whole selected field with \[REDACTED\]/);const bytes=options.reduce((sum,option)=>sum+Buffer.byteLength(option.textContent,'utf8'),0)+Buffer.byteLength(h.nodes.get('redact-selection').textContent,'utf8');assert.ok(bytes<=8192);assert.doesNotMatch(options.map(o=>o.textContent).join(''),/\uD83D(?![\uDC00-\uDFFF])/u);
});
test('null and alreadyredacted fields are omitted; selecting does notapply and exactpointer applies once',async()=>{
 const h=harness({title:null,context:'[REDACTED]',preferences:null,messages:[{text:null},{text:'[REDACTED]'},{role:'user',text:'Keep private'}]});await h.open();assert.deepEqual(h.options().map(o=>o.value),['/messages/2/text']);
 h.choose('/messages/2/text');assert.equal(h.calls.filter(([a])=>a==='migration-redact').length,0);const pending=h.click('redact-record');await Promise.resolve();await h.click('redact-record');
 const redactions=h.calls.filter(([a])=>a==='migration-redact');assert.equal(redactions.length,1);assert.equal(redactions[0][1].pointer,'/messages/2/text');assert.equal(redactions[0][1].record,'record-00000-00000.json');h.finish();await pending;
 assert.equal(h.nodes.get('redact-pointer').value,'');assert.equal(h.nodes.get('record-review').hidden,true);assert.equal(h.nodes.get('redact-record').disabled,true);
});
test('advancedpointer isexplicit and stalechoices clear onrecordlibraryandpendingverification',async()=>{
 const h=harness({title:'Title',messages:[{text:'Message'}]});await h.open();h.typed('/context/key with space ');assert.equal(h.nodes.get('redact-pointer').value,'/context/key with space ');assert.match(h.nodes.get('redact-selection').textContent,/Advanced field path/);
 await h.nodes.get('records').children[0].children[0].handlers.click();assert.equal(h.nodes.get('redact-pointer').value,'');h.choose('/title');await h.click('resume-library');assert.equal(h.nodes.get('redact-pointer').value,'');
 await h.nodes.get('records').children[0].children[0].handlers.click();h.choose('/title');h.api.run=async()=>new Promise(()=>{});h.click('process-batch');await Promise.resolve();h.progress({operation:'migration-run',phase:'checking',verification_pending:true,complete:false});assert.equal(h.nodes.get('redact-pointer').value,'');assert.equal(h.nodes.get('redact-choice').children.length,0);assert.equal(h.nodes.get('redact-record').disabled,true);
});
test('expired and pending libraries cannot apply a selected field',async()=>{
 for(const flags of [{expired:true},{verification_pending:true},{expires_at:'2000-01-01T00:00:00Z'}]){
  const h=harness({title:'Title',messages:[]},flags);await h.open();h.choose('/title');assert.equal(h.nodes.get('redact-record').disabled,true);await h.click('redact-record');assert.equal(h.calls.filter(([a])=>a==='migration-redact').length,0);
 }
});
