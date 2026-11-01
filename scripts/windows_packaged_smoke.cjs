'use strict';
// Disposable Windows CI only. Synthetic paths are supplied through Electron's
// documented dialog API, without adding production IPC or changing OS settings.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
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
async function main() {
  assert.equal(process.platform, 'win32', 'Run the packaged application on real Windows');
  const [executablePath, library, evidence] = process.argv.slice(2);
  const {_electron} = require(library);
  await fs.mkdir(evidence, {recursive:true});
  const source = path.join(evidence,'history 日本語.json');
  const recordCount = 1250; // Exceeds the engine's default 1000-record batch.
  await fs.writeFile(source, JSON.stringify(Array.from({length:recordCount}, (_,i) => ({id:String(i),messages:[{role:'user',timestamp:'2026-01-01T00:00:00Z',text:`Plan 日本語 🚀 ${i}`}]}))));
  const task = path.join(evidence,'task.json'), reference = path.join(evidence,'task.md');
  const workspace = path.join(evidence,'migration-library'), output = path.join(evidence,'portable');
  const app = await _electron.launch({executablePath,timeout:60000,env:{...process.env,PYTHON_MANAGER_AUTOMATIC_INSTALL:'false'}});
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(180000);
    await page.waitForFunction(async () => (await window.handoff.status()).ready);
    const ready = await page.evaluate(() => window.handoff.status());
    assert.equal(ready.platform,'win32');
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
    await choose(source,true); await page.locator('#choose-source').click(); await idle();
    await choose(workspace); await page.locator('#choose-workspace').click(); await idle();
    await page.locator('#confirm-migration').check();
    await page.locator('#plan-migration').click(); await idle();
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
    await capture(page,evidence,'windows-complete');
    const result = {platform:process.platform,executablePath,ready,records:recordCount,verifiedFiles:recordCount*2,
      checks:['packaged executable startup','Python discovery','Unicode Task Hand Off','reference export','Full Migration plan','durable reopen','automatic Full Migration batches','verified portable export'],
      gaps:['OS file picker uses documented synthetic dialog stubs','no signing or installer/SmartScreen validation','screenshots require human inspection; CI save alone is not visual review']};
    await fs.writeFile(path.join(evidence,'validation.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } finally {await app.close();}
}
main().catch(error => {console.error(error);process.exitCode=1;});
