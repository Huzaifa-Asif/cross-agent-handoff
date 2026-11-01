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
    await choose(reference); await page.locator('#export-task').click(); await idle();
    assert.match(await fs.readFile(reference,'utf8'),/Customer campaign 日本語 🚀/);
    await page.locator('#migration-tab').click();
    await page.locator('#source-provider').selectOption('generic');
    await page.locator('#source-format').selectOption('generic-json');
    await page.locator('#source-provider').selectOption('claude');
    assert.equal(await page.locator('#source-format').inputValue(),'generic-json');
    assert.match(await page.locator('#format-choice').innerText(),/choice is kept/);
    await page.locator('#source-provider').selectOption('generic');
    assert.match(await page.locator('#format-guidance').innerText(),/Generic JSON/);
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
      checks:['packaged executable startup','Python discovery','Unicode Task Hand Off','reference export','Full Migration plan','durable reopen','automatic Full Migration batches','verified portable export','exact mode accessibility labels','keyboard setup help','explicit format retained across provider changes','honest zero-record ready state','explicit guided redaction','selection does not apply','old exports/revisions/snapshot unchanged','new redacted export verified','raw source excluded after redaction'],
      gaps:['OS file picker uses documented synthetic dialog stubs','no signing or installer/SmartScreen validation','screenshots require human inspection; CI save alone is not visual review']};
    await fs.writeFile(path.join(evidence,'validation.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally {await app.close();}
}
main().catch(error => {console.error(error);process.exitCode=1;});
