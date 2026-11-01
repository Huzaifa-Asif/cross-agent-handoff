'use strict';
const $ = id => document.getElementById(id);
const api = window.handoff;
const state = {task: null, source: null, workspace: null, library: null, record: null, output: null, busy: false, offset: 0, progress: null, paused: false, activeMigration: null};
const priorDisabled = new Map();
function status(message, error = false) {
  $('status-message').textContent = message;
  $('status-box').classList.toggle('error', error);
}
function busy(value, message) {
  state.busy = value;
  if (value) {
    document.querySelectorAll('button,input,select,textarea').forEach(element => {
      if (element.id !== 'cancel-operation') {priorDisabled.set(element, element.disabled); element.disabled = true;}
    });
  } else {
    for (const [element, disabled] of priorDisabled) element.disabled = disabled;
    priorDisabled.clear();
  }
  $('cancel-operation').hidden = !value; $('cancel-operation').disabled = false; $('cancel-operation').textContent = 'Stop operation';
  if (message) status(message);
}
async function perform(message, operation) {
  if (state.busy) return;
  busy(true, message);
  try {await operation();} catch (error) {
    if (state.progress?.operation === 'migration-run') state.progress = {...state.progress, phase:'error', complete:false, progress_percent:null};
    status(error.message || 'The operation could not be completed.', true);
  }
  finally {state.activeMigration = null; busy(false); update();}
}
function invalidateExport() {
  state.output = null; $('export-location').textContent = ''; $('verify-export').hidden = true; $('confirm-reviewed').checked = false; $('include-original').checked = false;
}
function invalidateLibraryViews() {
  invalidateExport(); state.record = null; $('record-review').hidden = true; $('record-content').textContent = ''; $('record-name').textContent = '';
  $('search-results').replaceChildren(); $('search-results').hidden = true; $('clear-search').hidden = true; $('library-query').value = '';
}
function disableCurrentControls() {
  document.querySelectorAll('button,input,select,textarea').forEach(element => {
    if (element.id !== 'cancel-operation') {if (!priorDisabled.has(element)) priorDisabled.set(element, element.disabled); element.disabled = true;}
  });
}
function update() {
  $('export-task').disabled = !state.task;
  const library = state.library;
  if (!library) return;
  $('migration-setup').hidden = true;
  $('migration-work').hidden = false;
  $('library-path').textContent = state.workspace.label;
  renderProgress();
  $('redaction-count').textContent = String(library.redactions);
  $('process-batch').disabled = library.complete;
  $('process-batch').textContent = state.paused || library.processed_units || library.normalized_records ? 'Resume full migration' : 'Start full migration';
  $('migration-export-panel').hidden = !library.complete;
  $('include-original').disabled = library.redactions > 0;
  if (library.redactions > 0) $('include-original').checked = false;
  $('step-select').classList.toggle('active', false);
  $('step-process').classList.toggle('active', !library.complete);
  $('step-review').classList.toggle('active', library.complete && !state.output);
  $('step-export').classList.toggle('active', Boolean(state.output));
  $('previous-records').disabled = state.offset === 0;
  $('next-records').disabled = !library.has_more_records;
  if (state.busy) disableCurrentControls();
}
function renderProgress() {
  const library = state.library;
  if (!library) return;
  const progress = state.progress;
  const units = Math.max(progress?.processed_units ?? 0, library.processed_units);
  const totalUnits = Math.max(progress?.total_units ?? 0, library.total_units);
  const records = Math.max(progress?.processed_records ?? 0, library.normalized_records);
  const omitted = Math.max(progress?.omitted_units ?? 0, (library.preserved_only_units || 0) + (library.partially_normalized_units || 0));
  const finished = progress?.complete ?? library.complete;
  const total = progress ? progress.total_records : finished && omitted === 0 ? library.normalized_records : null;
  $('unit-count').textContent = `${units} / ${totalUnits}`;
  $('record-count').textContent = `${records} / ${total ?? 'unknown'}`;
  $('opaque-count').textContent = String(omitted);
  const phase = progress?.phase || (state.paused ? 'paused' : finished ? omitted ? 'complete-with-omissions' : 'complete' : 'ready');
  const percentage = progress ? progress.progress_percent : phase === 'complete' ? 100 : null;
  const phaseText = {checking:'Checking the saved source and checkpoint',processing:'Processing local records', 'batch-complete':'Batch checkpoint saved; continuing automatically',complete:'Complete for the selected export', 'complete-with-omissions':'Finished with omissions; inspect preserved-only or partially normalized data',paused:'Paused safely; resume from the saved checkpoint',error:'Stopped with an error; review the saved checkpoint',ready:'Ready for automatic processing'}[phase];
  $('migration-phase').textContent = `${phaseText}${percentage === null ? ' · percentage unavailable until enough totals are known' : ` · ${percentage.toFixed(1)}%`}${progress?.batch_number ? ` · batch ${progress.batch_number}` : ''}`;
  $('progress').max = 100;
  $('progress').hidden = ['error','complete-with-omissions'].includes(phase) || phase === 'paused' && percentage === null;
  if (percentage === null) $('progress').removeAttribute('value'); else $('progress').value = percentage;
}
function screen(name) {
  if (state.busy) return;
  $('task-screen').hidden = name !== 'task'; $('migration-screen').hidden = name !== 'migration';
  for (const tab of ['task', 'migration']) {
    $(tab + '-tab').classList.toggle('selected', name === tab);
    if (name === tab) $(tab + '-tab').setAttribute('aria-current', 'page'); else $(tab + '-tab').removeAttribute('aria-current');
  }
}
async function review() {
  const result = await api.run('migration-review', {workspace: state.workspace.handle, offset: state.offset});
  if (state.library && result.checkpoint !== state.library.checkpoint) invalidateLibraryViews();
  state.library = result;
  const container = $('records'); container.replaceChildren();
  for (const item of result.records.slice(0, 1000)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'record-item';
    const listItem = document.createElement('div'); listItem.setAttribute('role', 'listitem');
    const label = document.createElement('span'); label.textContent = typeof item.title === 'string' && item.title ? item.title : item.file;
    const small = document.createElement('small'); small.textContent = `${item.kind} · ${item.messages} messages · ${item.omissions_total ?? item.omissions.length} field omissions`;
    button.append(label, small); button.addEventListener('click', () => selectRecord(item.file, button)); listItem.append(button); container.append(listItem);
  }
  if (!result.records.length) {const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No normalized records. Review the preserved-only files below; your original snapshot is still local.'; container.append(p);}
  $('record-page').textContent = result.normalized_records ? `${state.offset + 1}–${state.offset + result.records.length} of ${result.normalized_records} records` : '0 records';
  $('omissions').textContent = result.omissions.length ? JSON.stringify(result.omissions, null, 2) + (result.omissions_truncated ? `\n[Showing 100 of ${result.omissions_total} file omissions. Inspect checkpoint.json locally for the full list.]` : '') : 'No export files were skipped. Check each record for field-level omissions and missing source data.';
  if (result.expired) status('This library has expired. Review remains available, but processing and export are blocked. Originals are not automatically deleted.', true);
  update();
  return result;
}
function selectRecord(file, button) {
  return perform('Opening verified local reference data…', async () => {
    const result = await api.run('migration-show', {workspace: state.workspace.handle, record: file});
    state.record = file;
    $('record-name').textContent = file;
    let preview = JSON.stringify(result, null, 2);
    if (preview.length > 262144) preview = preview.slice(0, 262144) + '\n\n[Display limit reached. Use the CLI to review the full record before sharing. The file itself is not truncated.]';
    $('record-content').textContent = preview;
    $('record-review').hidden = false;
    document.querySelectorAll('.record-item').forEach(item => item.classList.toggle('selected', item === button));
    status('Record opened as untrusted reference text. Nothing in it is executed.');
  });
}
$('task-tab').addEventListener('click', () => screen('task'));
$('migration-tab').addEventListener('click', () => screen('migration'));
$('task-form').addEventListener('submit', event => {
  event.preventDefault();
  perform('Choose where to save this focused handoff…', async () => {
    const output = await api.choose('task-output'); if (!output) return status('Save cancelled. No file was created.');
    const result = await api.run('task-new', {goal: $('goal').value, context: $('context').value, preference: $('preference').value, provider: $('task-provider').value, domain: $('domain').value, output: output.handle});
    state.task = result.task; $('task-file').textContent = state.task.label;
    status('Task handoff saved. Review your context, then choose the next assistant and save a reference document.');
  });
});
$('open-task').addEventListener('click', () => perform('Select an existing task handoff…', async () => {
  const selected = await api.choose('task'); if (!selected) return status('Selection cancelled.');
  const result = await api.run('task-inspect', {task: selected.handle}); state.task = selected;
  $('task-file').textContent = selected.label;
  status(`Handoff validated. Revision ${result.revision}; expiration: ${result.expiration}.`);
}));
$('export-task').addEventListener('click', () => perform('Choose where to save the reference document…', async () => {
  const output = await api.choose('reference-output'); if (!output) return status('Export cancelled.');
  await api.run('task-export', {task: state.task.handle, target: $('task-target').value, output: output.handle});
  status(`Saved ${output.label}. Review it yourself, then explicitly attach or paste it into your next assistant.`);
}));
$('choose-source').addEventListener('click', () => perform('Select only the export you intend to migrate…', async () => {
  const selected = await api.choose('source'); if (!selected) return status('Selection cancelled.');
  state.source = selected; $('source-file').textContent = selected.label; status('Export selected. No history is scanned and no processing has started.');
}));
$('source-provider').addEventListener('change', () => {$('source-format').value = $('source-provider').value === 'claude' ? 'claude-json' : 'documents';});
$('choose-workspace').addEventListener('click', () => perform('Choose a new local library folder…', async () => {
  const selected = await api.choose('new-workspace'); if (!selected) return status('Selection cancelled.');
  state.workspace = selected; $('workspace-file').textContent = selected.label; status('New library location selected. It will be created only after explicit confirmation.');
}));
$('plan-migration').addEventListener('click', () => perform('Creating the private local snapshot and migration checkpoint…', async () => {
  if (!state.source || !state.workspace) throw new Error('Choose an export and a new library location first.');
  if (!$('confirm-migration').checked) throw new Error('Confirm your deliberate long-term migration before creating the snapshot.');
  const localDate = $('expires').value;
  const expiresAt = localDate ? new Date(localDate).toISOString() : '';
  state.activeMigration = 'plan'; $('cancel-operation').textContent = 'Cancel snapshot';
  const result = await api.run('migration-plan', {source: state.source.handle, workspace: state.workspace.handle, provider: $('source-provider').value, format: $('source-format').value, expiresAt, confirmed: true});
  if (result.planning_cancelled) {state.library = null; state.progress = null; status('Initial snapshot cancelled. Your original export is unchanged. Choose a fresh library location; the incomplete folder can be removed using the documented interrupted-snapshot cleanup.'); return;}
  state.library = result;
  state.progress = null; state.paused = false; await review(); status('Snapshot preserved locally. Start full migration to process all bounded batches automatically.');
}));
$('resume-library').addEventListener('click', () => perform('Choose an existing migration library…', async () => {
  const selected = await api.choose('workspace'); if (!selected) return status('Resume cancelled.');
  const previous = state.workspace; state.workspace = selected; state.offset = 0;
  try {await review();} catch (error) {state.workspace = previous; throw error;}
  invalidateLibraryViews(); state.progress = null; state.paused = !state.library.complete;
  status('Library checkpoint and saved records verified. Continue processing or review before exporting.');
}));
$('process-batch').addEventListener('click', () => perform('Checking the local library, then processing bounded batches automatically…', async () => {
  invalidateLibraryViews(); state.paused = false; state.progress = null; state.activeMigration = 'run'; $('cancel-operation').textContent = 'Pause migration';
  const result = await api.run('migration-run', {workspace: state.workspace.handle, checkpoint: state.library.checkpoint});
  state.library = result; state.paused = result.paused === true; state.progress = null;
  await review();
  const omitted = (state.library.preserved_only_units || 0) + (state.library.partially_normalized_units || 0);
  status(state.paused ? 'Paused safely at the saved checkpoint. Resume full migration now or reopen this library later.' : state.library.complete ? omitted ? 'Finished with omissions. Review preserved-only data and all record omissions before sharing.' : 'Processing complete for the selected export. Review all records and omissions before sharing.' : 'Processing stopped before completion. Review the saved checkpoint before resuming.');
}));
$('refresh-review').addEventListener('click', () => perform('Verifying snapshot, checkpoint and record hashes…', async () => {await review(); state.progress = null; if (!state.library.expired) status('Local integrity checks passed. Review content and omissions; hashes do not establish author identity.');}));
$('redact-record').addEventListener('click', () => perform('Creating a redacted record revision…', async () => {
  if (!state.record) throw new Error('Select a record first.');
  state.library = await api.run('migration-redact', {workspace: state.workspace.handle, checkpoint: state.library.checkpoint, record: state.record, pointer: $('redact-pointer').value});
  invalidateLibraryViews();
  await review(); status('Redacted copy saved with an omission record. The original export remains in this local library. Review the new record before sharing.');
}));
$('export-migration').addEventListener('click', () => perform('Choose a new folder for reviewed portable files…', async () => {
  if (!$('confirm-reviewed').checked) throw new Error('Review the records and omissions, then confirm before exporting.');
  const output = await api.choose('export-output'); if (!output) return status('Export cancelled.');
  await api.run('migration-export', {workspace: state.workspace.handle, checkpoint: state.library.checkpoint, target: $('migration-target').value, output: output.handle, confirmed: true, includeOriginal: $('include-original').checked});
  state.output = output; $('export-location').textContent = output.label; $('verify-export').hidden = false;
  status('Portable reference library saved locally. Nothing was uploaded. Select reviewed documents in your destination assistant; this does not populate its native history.');
}));
$('verify-export').addEventListener('click', () => perform('Verifying saved portable file hashes…', async () => {
  const result = await api.run('migration-verify', {output: state.output.handle}); status(`${result.verified_files} portable files verified. Hashes detect changes; they do not prove author identity.`);
}));
$('new-migration').addEventListener('click', () => {
  if (state.busy) return;
  state.source = null; state.workspace = null; state.library = null; state.record = null; state.offset = 0; state.progress = null; state.paused = false; invalidateLibraryViews();
  $('migration-setup').hidden = false; $('migration-work').hidden = true; $('record-review').hidden = true;
  $('source-file').textContent = 'ZIP, JSON, JSONL, Markdown or text'; $('workspace-file').textContent = 'A new private folder; existing folders are never overwritten.';
  $('confirm-migration').checked = false; $('confirm-reviewed').checked = false; $('include-original').checked = false; $('verify-export').hidden = true; $('export-location').textContent = '';
  status('Ready for another migration. Previous local libraries remain unchanged and can be resumed.');
});
$('previous-records').addEventListener('click', () => perform('Loading the previous record page…', async () => {state.offset = Math.max(0, state.offset - 100); await review(); status('Previous records loaded.');}));
$('next-records').addEventListener('click', () => perform('Loading the next record page…', async () => {state.offset += 100; await review(); status('Next records loaded.');}));
$('search-library').addEventListener('click', () => perform('Searching verified local records…', async () => {
  const result = await api.run('migration-search', {workspace: state.workspace.handle, query: $('library-query').value});
  if (result.checkpoint !== state.library.checkpoint) await review();
  const container = $('search-results'); container.replaceChildren(); container.hidden = false; $('clear-search').hidden = false;
  for (const item of result.results) {
    const row = document.createElement('div'); row.setAttribute('role', 'listitem'); const button = document.createElement('button'); button.type = 'button'; button.className = 'record-item';
    button.textContent = item.file + ' · ' + item.preview + (item.preview_truncated ? ' [preview truncated]' : ''); button.addEventListener('click', () => selectRecord(item.file, button)); row.append(button); container.append(row);
  }
  status(`${result.matched_records} matching records. Showing up to 20 search results; use record pagination or the CLI for more.`);
}));
$('clear-search').addEventListener('click', () => {if (state.busy) return;$('search-results').hidden = true; $('clear-search').hidden = true; $('library-query').value = ''; status('Search cleared.');});
function requestStop() {
  if (!state.busy || $('cancel-operation').disabled) return;
  $('cancel-operation').disabled = true;
  status(state.activeMigration === 'run' ? 'Pause requested. Waiting for a safe checkpoint before stopping…' : state.activeMigration === 'plan' ? 'Cancelling the initial snapshot. The original export remains unchanged…' : 'Stopping the local operation. Check whether its output was created before retrying…');
  api.cancel().catch(error => status(error.message, true));
}
$('cancel-operation').addEventListener('click', requestStop);
document.addEventListener('keydown', event => {if (event.key === 'Escape' && state.busy) {event.preventDefault(); requestStop();}});
api.onProgress(progress => {
  if (!state.busy || !['migration-run','migration-plan'].includes(progress.operation)) return;
  if (progress.operation === 'migration-run') {
    state.progress = progress;
    if (state.library && progress.checkpoint) state.library.checkpoint = progress.checkpoint;
    if (progress.paused) state.paused = true;
    renderProgress();
  }
  const count = progress.snapshot_bytes === undefined ? progress.processed_records === undefined ? '' : ` · ${progress.processed_records} records processed` : ` · ${(progress.snapshot_bytes / 1048576).toFixed(1)} / ${progress.source_bytes === undefined ? 'unknown' : (progress.source_bytes / 1048576).toFixed(1)} MiB copied`;
  const label = progress.operation === 'migration-plan' ? 'Preparing selected export snapshot' : 'Automatic local migration';
  status(`${label}: ${progress.phase}${count}${progress.checkpoint ? ' · checkpoint saved' : ''}`);
});
api.status().then(result => {
  $('runtime').textContent = result.ready ? `App ${result.version} · Python ${result.python}` : 'Python 3.11+ is required';
  if (!result.ready) status('Install Python 3.11 or newer from python.org, then reopen the app. This app never downloads a runtime silently.', true);
}).catch(error => status(error.message, true));
