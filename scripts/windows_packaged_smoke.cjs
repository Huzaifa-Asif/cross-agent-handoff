'use strict';
// Disposable Windows CI only. Synthetic paths are supplied through Electron's
// documented dialog API, without adding production IPC or changing OS settings.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {createReadStream} = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
async function capture(page, evidence, name) {
  const bytes = await page.screenshot({path:path.join(evidence,name+'.png')});
  assert.ok(bytes.length <= 1048576, 'Bounded synthetic screenshot evidence');
  const data = bytes.toString('base64');
  const count = Math.ceil(data.length / 4096);
  console.log(JSON.stringify({handoffScreenshot:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),chunks:count}));
  for(let index=0;index<count;index++) console.log(JSON.stringify({handoffScreenshot:name,index,data:data.slice(index*4096,(index+1)*4096)}));
}
async function packageManifest(root) {
  const files=[]; let total=0,actualTotal=0,visited=0;
  async function visit(directory,depth) {
    assert.ok(depth<=12,'Bounded package directory depth');
    for(const name of (await fs.readdir(directory)).sort()) {
      assert.ok(++visited<=4096,'Bounded package entries');
      const file=path.join(directory,name), info=await fs.lstat(file);
      assert.ok(!info.isSymbolicLink(),'Package manifest refuses symbolic links');
      if(info.isDirectory()){await visit(file,depth+1);continue;}
      assert.ok(info.isFile(),'Ordinary package files only');
      assert.ok(files.length<2048 && info.size<=536870912,'Bounded package file count and size');
      total+=info.size; assert.ok(total<=1073741824,'Bounded total package bytes');
      const hash=createHash('sha256'); let actual=0;
      for await(const chunk of createReadStream(file)){
        actual+=chunk.length;actualTotal+=chunk.length;
        assert.ok(actual<=536870912 && actualTotal<=1073741824,'Bounded bytes actually read');
        hash.update(chunk);
      }
      assert.equal(actual,info.size,'Package file size changed while hashing');
      const after=await fs.lstat(file);
      assert.ok(after.isFile() && !after.isSymbolicLink(),'Package entry changed type');
      assert.deepEqual([after.dev,after.ino,after.size,after.mtimeMs],[info.dev,info.ino,info.size,info.mtimeMs],'Package entry changed while hashing');
      files.push({file:path.relative(root,file).split(path.sep).join('/'),bytes:info.size,sha256:hash.digest('hex')});
    }
  }
  await visit(root,0);return files;
}
async function main() {
  assert.equal(process.platform, 'win32', 'Run the packaged application on real Windows');
  const [executablePath, library, evidence] = process.argv.slice(2);
  const {_electron} = require(library);
  await fs.mkdir(evidence, {recursive:true});
  const source = path.join(evidence,'history 日本語.json');
  const recordCount = 1250; // Exceeds the engine's default 1000-record batch.
  await fs.writeFile(source, JSON.stringify(Array.from({length:recordCount}, (_,i) => ({id:String(i),messages:[{role:'user',timestamp:'2026-01-01T00:00:00Z',text:`Plan 日本語 🚀 ${i}`}]}))));
  const task = path.join(evidence,'task.json'), reference = path.join(evidence,'task.md');
  const workspace = path.join(evidence,'migration-library'), output = path.join(evidence,'portable'), redactedOutput = path.join(evidence,'portable-redacted');
  const app = await _electron.launch({executablePath,timeout:60000,env:{...process.env,PYTHON_MANAGER_AUTOMATIC_INSTALL:'false'}});
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(180000);
    await page.waitForFunction(async () => (await window.handoff.status()).ready);
    const ready = await page.evaluate(() => window.handoff.status());
    assert.equal(ready.platform,'win32');
    assert.equal(await page.getByRole('button',{name:'Task Hand Off',exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'Full Migration',exact:true}).count(),1);
    await page.locator('#local-help summary').press('Enter');
    assert.equal(await page.locator('#local-help').getAttribute('open'),'');
    assert.match(await page.locator('#setup-help').innerText(),/Local runtime ready/);
    await page.locator('#local-help summary').press('Enter');
    const choose = async (file, open=false) => app.evaluate(({dialog},{file,open}) => {
      if(open) dialog.showOpenDialog = async () => ({canceled:false,filePaths:[file]});
      else dialog.showSaveDialog = async () => ({canceled:false,filePath:file});
    },{file,open});
    const idle = async () => {
      await page.locator('#cancel-operation').waitFor({state:'hidden'});
      assert.equal(await page.locator('#status-box').evaluate(element=>element.classList.contains('error')),false,
        await page.locator('#status-message').innerText());
    };
    await page.locator('#goal').fill('Customer campaign 日本語 🚀');
    await page.locator('#context').fill('Budget approval pending; synthetic fixture only.');
    await page.locator('#domain').selectOption('marketing');
    await choose(task); await page.locator('#task-form button[type=submit]').click(); await idle();
    assert.match(await fs.readFile(task,'utf8'),/Customer campaign 日本語 🚀/);
    assert.equal(await page.locator('#task-create').isHidden(),true);
    assert.match(await page.locator('#task-goal').innerText(),/Customer campaign 日本語 🚀/);
    assert.match(await page.locator('#task-context').innerText(),/Budget approval pending/);
    assert.equal(await page.locator('#export-task').isDisabled(),true);
    await page.locator('#task-all-fields summary').press('Enter');
    assert.deepEqual(JSON.parse(await page.locator('#task-content').innerText()),JSON.parse(await fs.readFile(task,'utf8')));
    await page.locator('#task-all-fields summary').press('Enter');
    await page.locator('#confirm-task-reviewed').check();
    await choose(reference); await page.locator('#export-task').click(); await idle();
    assert.match(await fs.readFile(reference,'utf8'),/Customer campaign 日本語 🚀/);
    const developerTask=path.join(evidence,'developer-task.json'),developerReference=path.join(evidence,'developer-task.md');
    const staleReference=path.join(evidence,'stale-must-not-exist.md'),recoveredReference=path.join(evidence,'reviewed-again.md');
    const marker=path.join(evidence,'NEVER_EXECUTE');
    const developer=JSON.parse(await fs.readFile(path.resolve(__dirname,'../examples/example.json'),'utf8'));
    developer.goal[0].text='Developer context 日本語 🚀 <script>inert</script>';
    developer.expires_at=developer.created_at;
    developer.tests[0].command='$(touch '+marker+')';
    await fs.writeFile(developerTask,JSON.stringify(developer));
    await page.locator('#new-task').click();
    await choose(developerTask,true); await page.locator('#open-task').click(); await idle();
    assert.equal(await page.locator('#task-create').isHidden(),true);
    assert.match(await page.locator('#task-goal').innerText(),/Developer context 日本語 🚀 <script>inert<\/script>/);
    assert.match(await page.locator('#task-expiration').innerText(),/expired.*informational/);
    await page.locator('#task-all-fields summary').press('Enter');
    assert.deepEqual(JSON.parse(await page.locator('#task-content').innerText()),developer);
    await page.locator('#task-all-fields summary').press('Enter');
    await page.locator('#task-review-title').evaluate(element=>element.scrollIntoView({block:'start'}));
    await capture(page,evidence,'windows-task-review');
    await page.locator('#confirm-task-reviewed').check();
    await choose(developerReference); await page.locator('#export-task').click(); await idle();
    assert.match(await fs.readFile(developerReference,'utf8'),/report\.txt/);
    await assert.rejects(fs.access(marker),{code:'ENOENT'});
    developer.goal[0].text='Changed outside the reviewed snapshot';
    const changedBytes=JSON.stringify(developer);await fs.writeFile(developerTask,changedBytes);
    await choose(staleReference); await page.locator('#export-task').click();
    await page.locator('#cancel-operation').waitFor({state:'hidden'});
    assert.equal(await page.locator('#status-box').evaluate(element=>element.classList.contains('error')),true);
    assert.match(await page.locator('#status-message').innerText(),/handoff changed.*Reopen and review/);
    assert.equal(await page.locator('#task-review').isHidden(),true);
    assert.equal(await page.locator('#export-task').isDisabled(),true);
    await assert.rejects(fs.access(staleReference),{code:'ENOENT'});
    assert.equal(await fs.readFile(developerTask,'utf8'),changedBytes);
    await choose(developerTask,true); await page.locator('#open-task').click(); await idle();
    assert.match(await page.locator('#task-goal').innerText(),/Changed outside the reviewed snapshot/);
    assert.equal(await page.locator('#confirm-task-reviewed').isChecked(),false);
    await page.locator('#confirm-task-reviewed').check();
    await choose(recoveredReference); await page.locator('#export-task').click(); await idle();
    assert.match(await fs.readFile(recoveredReference,'utf8'),/Changed outside the reviewed snapshot/);
    await page.locator('#new-task').click();
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
    await page.locator('#open-task').click(); await idle();
    assert.equal(await page.locator('#task-review').isHidden(),true);
    assert.equal(await page.locator('#export-task').isDisabled(),true);
    await page.locator('#migration-tab').click();
    await page.locator('#source-provider').selectOption('generic');
    await page.locator('#source-format').selectOption('generic-json');
    await page.locator('#source-provider').selectOption('claude');
    assert.equal(await page.locator('#source-format').inputValue(),'generic-json');
    assert.match(await page.locator('#format-choice').innerText(),/choice is kept/);
    await page.locator('#source-provider').selectOption('generic');
    assert.match(await page.locator('#format-guidance').innerText(),/Generic JSON/);
    // A malformed selected source is preserved with omissions, not described as
    // exported conversation content when the default copy contains only metadata.
    const emptySource=path.join(evidence,'malformed-selected.json');
    const emptyWorkspace=path.join(evidence,'metadata-only-library'),emptyOutput=path.join(evidence,'metadata-only-copy');
    await fs.writeFile(emptySource,'{');
    await choose(emptySource,true); await page.locator('#choose-source').click(); await idle();
    await choose(emptyWorkspace); await page.locator('#choose-workspace').click(); await idle();
    await page.locator('#confirm-migration').check();
    await page.locator('#plan-migration').click(); await idle();
    await page.locator('#process-batch').click(); await idle();
    assert.equal(await page.locator('#record-count').innerText(),'0 / unknown');
    assert.equal(await page.locator('#opaque-count').innerText(),'1');
    assert.doesNotMatch(await page.locator('#migration-phase').innerText(),/100\.0%/);
    assert.match(await page.locator('#migration-export-description').innerText(),/metadata only: no conversations/i);
    await page.locator('#confirm-reviewed').check();
    await choose(emptyOutput); await page.locator('#export-migration').click(); await idle();
    assert.match(await page.locator('#status-message').innerText(),/contains no conversations, reference documents or original export/i);
    assert.deepEqual((await fs.readdir(emptyOutput)).sort(),['README.txt','manifest.json']);
    await page.locator('#verify-export').click(); await idle();
    assert.match(await page.locator('#status-message').innerText(),/no content-file hashes to check/i);
    assert.equal(await fs.readFile(emptySource,'utf8'),'{');
    const metadataBefore=await Promise.all(['README.txt','manifest.json'].map(name=>fs.readFile(path.join(emptyOutput,name))));
    const rejectedDestination=path.join(evidence,'existing-metadata-destination');
    await fs.mkdir(rejectedDestination); await fs.writeFile(path.join(rejectedDestination,'sentinel.txt'),'Preserve synthetic existing data');
    await choose(rejectedDestination); await page.locator('#export-migration').click();
    await page.locator('#cancel-operation').waitFor({state:'hidden'});
    assert.equal(await page.locator('#status-box').evaluate(element=>element.classList.contains('error')),true);
    assert.equal(await page.locator('#verify-export').isHidden(),true);
    assert.equal(await fs.readFile(path.join(rejectedDestination,'sentinel.txt'),'utf8'),'Preserve synthetic existing data');
    assert.deepEqual((await fs.readdir(emptyOutput)).sort(),['README.txt','manifest.json']);
    for (const [index,name] of ['README.txt','manifest.json'].entries()) assert.deepEqual(await fs.readFile(path.join(emptyOutput,name)),metadataBefore[index]);
    await page.locator('#new-migration').click();
    await page.locator('#source-provider').selectOption('generic');
    await page.locator('#source-format').selectOption('generic-json');
    await choose(source,true); await page.locator('#choose-source').click(); await idle();
    await choose(workspace); await page.locator('#choose-workspace').click(); await idle();
    await page.locator('#confirm-migration').check();
    await page.locator('#plan-migration').click(); await idle();
    assert.match(await page.locator('#records').innerText(),/Processing has not started/);
    await capture(page,evidence,'windows-planned');
    // Reopen the durable plan through the user-facing resume path.
    await page.locator('#new-migration').click();
    await choose(workspace,true); await page.locator('#resume-library').click(); await idle();
    await page.evaluate(() => {
      window.__smokeProgress = [];
      window.handoff.onProgress(value => window.__smokeProgress.push(value));
    });
    await page.locator('#process-batch').click(); await idle();
    assert.equal(await page.locator('#record-count').innerText(),`${recordCount} / ${recordCount}`);
    assert.match(await page.locator('#migration-phase').innerText(),/Complete|finished/i);
    const progress = await page.evaluate(() => window.__smokeProgress);
    assert.ok(progress.some(event=>event.operation==='migration-run' && event.batch_number>=2),
      'Packaged Full Migration must actually cross an automatic batch boundary');
    await page.locator('#confirm-reviewed').check();
    await choose(output); await page.locator('#export-migration').click(); await idle();
    await page.locator('#verify-export').click(); await idle();
    assert.match(await page.locator('#status-message').innerText(),/^2500 portable files verified/);
    const firstManifest=await fs.readFile(path.join(output,'manifest.json'));
    await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});
    await page.locator('#export-migration').click(); await idle();
    assert.equal(await page.locator('#verify-export').isHidden(),false);
    assert.match(await page.locator('#status-message').innerText(),/earlier saved copy is still selected/i);
    // This destination passes main-process selection. Corrupt only our synthetic
    // cached snapshot to exercise a genuine post-selection backend failure.
    const failedDestination=path.join(evidence,'failed-new-copy');
    const failureSnapshotPath=path.join(workspace,'source.bin');
    const preservedSnapshot=await fs.readFile(failureSnapshotPath);
    try {
      await fs.appendFile(failureSnapshotPath,'\n');
      await choose(failedDestination); await page.locator('#export-migration').click();
      await page.locator('#cancel-operation').waitFor({state:'hidden'});
      assert.equal(await page.locator('#status-box').evaluate(element=>element.classList.contains('error')),true);
      assert.equal(await page.locator('#verify-export').isHidden(),true);
      assert.ok((await page.locator('#export-location').innerText()).includes(failedDestination));
      await assert.rejects(fs.access(failedDestination),{code:'ENOENT'});
    } finally {await fs.writeFile(failureSnapshotPath,preservedSnapshot);}
    assert.deepEqual(await fs.readFile(path.join(output,'manifest.json')),firstManifest);
    const recoveredCopy=path.join(evidence,'reviewed-copy-again');
    await page.locator('#confirm-reviewed').check();
    await choose(recoveredCopy); await page.locator('#export-migration').click(); await idle();
    await page.locator('#verify-export').click(); await idle();
    const recoveredManifestPath=path.join(recoveredCopy,'manifest.json');
    const recoveredManifest=await fs.readFile(recoveredManifestPath);
    const changedManifest=JSON.parse(recoveredManifest);changedManifest.checkpoint='0'.repeat(64);
    await fs.writeFile(recoveredManifestPath,JSON.stringify(changedManifest));
    await page.locator('#verify-export').click();
    await page.locator('#cancel-operation').waitFor({state:'hidden'});
    assert.equal(await page.locator('#status-box').evaluate(element=>element.classList.contains('error')),true);
    assert.equal(await page.locator('#verify-export').isHidden(),true);
    assert.match(await page.locator('#status-message').innerText(),/could not be verified as the selected copy/i);
    await fs.writeFile(recoveredManifestPath,recoveredManifest);
    const checkpointBefore=await fs.readFile(path.join(workspace,'checkpoint.json'));
    const oldState=JSON.parse(checkpointBefore).data;
    const oldRecordName=oldState.records[0].file;
    const oldPortableRecord=await fs.readFile(path.join(output,oldRecordName));
    const oldRecord=JSON.parse(oldPortableRecord);
    const originalSnapshot=await fs.readFile(path.join(workspace,'source.bin'));
    await page.locator('#records button').first().click(); await idle();
    await page.locator('#redact-choice').selectOption('/messages/0/text');
    assert.deepEqual(await fs.readFile(path.join(workspace,'checkpoint.json')),checkpointBefore,
      'Selecting a guided field must not mutate the library');
    assert.match(await page.locator('#redact-warning').innerText(),/Existing portable exports are unchanged/);
    await page.locator('#record-review').scrollIntoViewIfNeeded();
    await capture(page,evidence,'windows-redaction-selection');
    await page.locator('#redact-record').click(); await idle();
    assert.equal(await page.locator('#redaction-count').innerText(),'1');
    assert.match(await page.locator('#migration-phase').innerText(),/1 intentional redactions/);
    assert.doesNotMatch(await page.locator('#migration-phase').innerText(),/100\.0%/);
    assert.equal(await page.locator('#include-original').isDisabled(),true);
    assert.equal(await page.locator('#redact-pointer').inputValue(),'');
    assert.deepEqual(await fs.readFile(path.join(output,oldRecordName)),oldPortableRecord,
      'Earlier portable exports must remain unchanged');
    assert.deepEqual(await fs.readFile(path.join(workspace,oldRecordName)),oldPortableRecord,
      'Earlier local record revision must remain unchanged');
    assert.deepEqual(await fs.readFile(path.join(workspace,'source.bin')),originalSnapshot,
      'Redaction must retain the original snapshot');
    await page.locator('#confirm-reviewed').check();
    await choose(redactedOutput); await page.locator('#export-migration').click(); await idle();
    await page.locator('#verify-export').click(); await idle();
    assert.match(await page.locator('#status-message').innerText(),/^2500 portable files verified/);
    const newState=JSON.parse(await fs.readFile(path.join(workspace,'checkpoint.json'))).data;
    const newRecord=JSON.parse(await fs.readFile(path.join(redactedOutput,newState.records[0].file)));
    assert.equal(newRecord.messages[0].text,'[REDACTED]');
    assert.deepEqual({...newRecord.messages[0],text:oldRecord.messages[0].text},oldRecord.messages[0]);
    assert.equal(newRecord.id,oldRecord.id);
    assert.equal(newRecord.omissions.length,oldRecord.omissions.length+1);
    assert.deepEqual({...newRecord,messages:oldRecord.messages,omissions:oldRecord.omissions},oldRecord);
    await assert.rejects(fs.access(path.join(redactedOutput,'original-export.bin')),{code:'ENOENT'});
    await capture(page,evidence,'windows-complete');
    const result = {platform:process.platform,executablePath,ready,records:recordCount,verifiedFiles:recordCount*2,packageFiles:await packageManifest(path.dirname(executablePath)),
      checks:['packaged executable startup','Python discovery','Unicode Task Hand Off','business and developer saved snapshots preserve all fields','separate creation and read-only review','explicit task review confirmation','informational task expiry','digest-bound reference export','stale source rejected without output','reopen and review recovery','cancelled open clears prior task','malformed selected source has honest zero-record omissions','metadata-only copy explicitly contains no conversation data','no false zero-file metadata authentication','Full Migration plan','durable reopen','automatic Full Migration batches','verified portable export','cancelled destination preserves earlier selected copy','failed new destination clears prior verification selection','existing data unchanged after failure','changed portable checkpoint rejected in current-copy verification','fresh-copy export recovery','exact mode accessibility labels','keyboard setup help','explicit format retained across provider changes','honest zero-record ready state','explicit guided redaction','selection does not apply','old exports/revisions/snapshot unchanged','new redacted export verified','raw source excluded after redaction'],
      gaps:['OS file picker uses documented synthetic dialog stubs','no signing or installer/SmartScreen validation','screenshots require human inspection; CI save alone is not visual review']};
    await fs.writeFile(path.join(evidence,'validation.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally {await app.close();}
}
main().catch(error => {console.error(error);process.exitCode=1;});
