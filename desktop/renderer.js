'use strict';
const $ = id => document.getElementById(id);
const api = window.handoff;
const state = {task: null, source: null, workspace: null, library: null, record: null, output: null, busy: false, offset: 0, progress: null, paused: false, activeMigration: null, formatTouched: false};
const priorDisabled = new Map();
function recovery(message) {$('recovery-help').textContent = message;}
function formatGuidance() {
  const provider = $('source-provider').value;
  const format = $('source-format').value;
  const providerText = {
    claude:'Claude: request an official account export. Select the downloaded JSON or ZIP; memory text is a separate, selective export.',
    codex:'Codex: prefer an exported Markdown or text session. Internal JSONL is experimental and can change between versions.',
    cursor:'Cursor: use selected exported documents or a supported generic format. A verified full-account Cursor parser is not available.',
    gemini:'Gemini: use selected readable documents or a supported generic format. This app does not parse every Google Takeout layout.',
    grok:'Grok: use selected readable documents or a supported generic format. A verified full-account Grok parser is not available.',
    generic:'Other / general: choose the format matching the file contents. A JSON filename alone does not identify a supported conversation layout.'
  };
  const formatText = {
    'claude-json':'Claude JSON: reads a supported subset of Claude conversation export layouts. Other provider JSON is not automatically compatible.',
    documents:'Documents: keeps Markdown and plain text as reference documents. It does not reconstruct conversation roles or timestamps from prose.',
    'generic-json':'Generic JSON: reads supported structured conversation lists. Arbitrary JSON and provider-specific layouts may be preserved with omissions.',
    'generic-jsonl':'Generic JSONL: reads one supported structured conversation record per line; it is not a universal provider export parser.',
    'codex-jsonl-experimental':'Codex JSONL: experimental parsing of selected internal session layouts. Prefer a rendered session export when available.',
    archive:'Preserve only: retains the selected original export locally without parsing conversations. Portable output excludes that original by default; including it requires explicit review and opt-in.'
  };
  $('provider-guidance').textContent = providerText[provider] || providerText.generic;
  $('format-guidance').textContent = formatText[format] || 'Choose a supported format matching the selected file contents.';
  $('format-choice').textContent = state.formatTouched ? 'Your format choice is kept when the source assistant changes. Check it matches the file contents before creating a plan.' : 'Suggested starting format. Change it to match your export; the source assistant is a label, not an account connection.';
}
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
    if (state.activeMigration === 'run') state.progress = {...state.progress, operation:'migration-run', verification_pending:state.progress?.verification_pending ?? state.library?.verification_pending ?? false, phase:'error', complete:false, progress_percent:null};
    status(error.message || 'The operation could not be completed.', true);
    recovery('An operation stopped. Check whether an output was created before retrying. For a saved migration, use Resume library to verify its checkpoint; for an interrupted initial snapshot, choose a fresh folder.');
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
function pendingReview() {
  invalidateLibraryViews(); state.offset = 0;
  if (state.library) state.library.has_more_records = false;
  const message = document.createElement('p'); message.className = 'muted';
  message.textContent = 'Record review awaits verification. Resume processing, or choose Refresh review explicitly to verify saved records and findings.';
  $('records').replaceChildren(message); $('record-page').textContent = 'Verification pending';
  $('omissions').textContent = 'File omissions and field findings await verification. Resume or Refresh review explicitly to verify them.';
  $('previous-records').disabled = true; $('next-records').disabled = true;
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
  $('redaction-count').textContent = (state.progress?.verification_pending ?? library.verification_pending) ? 'Not verified' : library.redactions === undefined ? 'Not verified' : String(library.redactions);
  $('process-batch').disabled = library.complete || Boolean(library.expired);
  $('export-migration').disabled = Boolean(library.expired || library.verification_pending);
  $('process-batch').textContent = state.paused || library.processed_units || library.normalized_records ? 'Resume full migration' : 'Start full migration';
  $('migration-export-panel').hidden = !library.complete || Boolean(library.verification_pending);
  $('include-original').disabled = library.redactions > 0 || Boolean(library.expired || library.verification_pending);
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
  const pending = progress?.verification_pending ?? library.verification_pending;
  const units = Math.max(progress?.processed_units ?? 0, library.processed_units ?? 0);
  const totalUnits = Math.max(progress?.total_units ?? 0, library.total_units ?? 0);
  const records = Math.max(progress?.processed_records ?? 0, library.normalized_records ?? 0);
  const omitted = Math.max(progress?.omitted_units ?? 0, (library.preserved_only_units || 0) + (library.partially_normalized_units || 0));
  const findings = Object.fromEntries(['record_omissions','missing_source_fields','intentional_redactions','reference_notices'].map(key => [key, progress?.[key] ?? library[key] ?? 0]));
  const hasNotices = findings.missing_source_fields + findings.intentional_redactions + findings.reference_notices > 0;
  const finished = !pending && (progress?.complete ?? library.complete);
  const total = pending ? null : progress ? progress.total_records : finished && omitted === 0 ? library.normalized_records : null;
  $('unit-count').textContent = `${units} / ${totalUnits}`;
  $('record-count').textContent = `${records} / ${total ?? 'unknown'}`;
  $('opaque-count').textContent = pending ? 'Not verified' : String(omitted);
  if (pending) $('redaction-count').textContent = 'Not verified';
  const phase = progress?.phase || (finished ? omitted || findings.record_omissions ? 'complete-with-omissions' : hasNotices ? 'complete-with-notices' : 'complete' : state.paused ? 'paused' : 'ready');
  const percentage = pending ? null : progress ? progress.progress_percent : phase === 'complete' ? 100 : null;
  const phaseText = {checking:'Checking the saved source and checkpoint',processing:'Processing local records', 'batch-complete':'Batch checkpoint saved; continuing automatically',complete:'Complete for the selected export', 'complete-with-omissions':'Finished with omissions; inspect file and record findings', 'complete-with-notices':'Processing finished; review source-data notices and intentional changes',paused:'Paused safely; resume from the saved checkpoint',error:'Stopped with an error; review the saved checkpoint',ready:'Ready for automatic processing'}[phase];
  if (pending) {
    $('migration-phase').textContent = phase === 'paused' ? 'Paused while verifying; checkpoint retained. Findings are not verified. Resume or Refresh review explicitly to verify them.' : phase === 'error' ? 'Stopped during verification. Findings remain unverified; Resume or Refresh review explicitly to verify the saved library.' : 'Verifying the saved library. Findings are not verified yet; record review will be available after verification.';
    $('progress').hidden = phase === 'paused' || phase === 'error'; $('progress').removeAttribute('value'); return;
  }
  $('migration-phase').textContent = `${phaseText}${percentage === null ? finished ? ' · review findings before sharing' : ' · percentage unavailable until enough totals are known' : ` · ${percentage.toFixed(1)}%`}${progress?.batch_number ? ` · batch ${progress.batch_number}` : ''}`;
  $('migration-phase').textContent += ` · ${findings.record_omissions} record omissions · ${findings.missing_source_fields} missing source fields · ${findings.intentional_redactions} intentional redactions · ${findings.reference_notices} reference notices`;
  $('progress').max = 100;
  $('progress').hidden = ['ready','error','complete-with-omissions','complete-with-notices'].includes(phase) || phase === 'paused' && percentage === null;
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
    const small = document.createElement('small'); small.textContent = `${item.kind} · ${item.messages} messages · ${item.omissions_total ?? item.omissions.length} review findings`;
    button.append(label, small); button.addEventListener('click', () => selectRecord(item.file, button)); listItem.append(button); container.append(listItem);
  }
  if (!result.records.length) {const p = document.createElement('p'); p.className = 'muted'; p.textContent = result.expired ? 'This library has expired. No conversation records are available on this page. Review remains available, but processing and export are blocked.' : !result.complete && result.processed_units === 0 && result.normalized_records === 0 ? 'Processing has not started. Start or resume full migration to read the selected export; the local snapshot is already preserved.' : !result.complete ? 'No conversation records have been created yet. Resume processing, then review any preserved-only files and omissions.' : 'No conversation records were parsed. Review the preserved-only files and omissions; your original snapshot is still local.'; container.append(p);}
  $('record-page').textContent = result.normalized_records ? `${state.offset + 1}–${state.offset + result.records.length} of ${result.normalized_records} records` : '0 records';
  $('omissions').textContent = result.omissions.length ? JSON.stringify(result.omissions, null, 2) + (result.omissions_truncated ? `\n[Showing 100 of ${result.omissions_total} file omissions. Inspect checkpoint.json locally for the full list.]` : '') : 'No export files were skipped. Check each record for field-level omissions and missing source data.';
  if (result.expired) {recovery('This library has expired. You can review it, but further processing and export are blocked. Original files are not automatically deleted.'); status('This library has expired. Review remains available, but processing and export are blocked. Originals are not automatically deleted.', true);}
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
$('source-provider').addEventListener('change', () => {if (state.busy) return; if (!state.formatTouched) $('source-format').value = $('source-provider').value === 'claude' ? 'claude-json' : 'documents'; formatGuidance();});
$('source-format').addEventListener('change', () => {if (state.busy) return; state.formatTouched = true; formatGuidance();});
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
  if (result.planning_cancelled) {state.library = null; state.progress = null; recovery('Initial snapshot cancelled before a resumable checkpoint. Your original export is unchanged. Choose a fresh library location, then create a new plan. The incomplete folder is not deleted here.'); status('Initial snapshot cancelled. Your original export is unchanged. Choose a fresh library location; the incomplete folder can be removed using the documented interrupted-snapshot cleanup.'); return;}
  state.library = result;
  state.progress = null; state.paused = false; await review(); if (state.library.expired) return; recovery('Your selected export is preserved locally. Processing has not started: choose Start full migration once to process all bounded batches.'); status('Snapshot preserved locally. Start full migration to process all bounded batches automatically.');
}));
$('resume-library').addEventListener('click', () => perform('Choose an existing migration library…', async () => {
  const selected = await api.choose('workspace'); if (!selected) return status('Resume cancelled.');
  const previous = state.workspace; state.workspace = selected; state.offset = 0;
  try {await review();} catch (error) {state.workspace = previous; throw error;}
  invalidateLibraryViews(); state.progress = null; state.paused = !state.library.complete;
  if (state.library.expired) return;
  recovery(state.library.complete ? 'This library is complete for the selected export. Review its findings and sensitive content before saving portable files.' : 'Saved library verified. Choose Resume full migration to continue from its checkpoint; you do not need to select the original export again.');
  status('Library checkpoint and saved records verified. Continue processing or review before exporting.');
}));
$('process-batch').addEventListener('click', () => perform('Checking the local library, then processing bounded batches automatically…', async () => {
  invalidateLibraryViews(); state.paused = false; state.progress = null; state.activeMigration = 'run'; $('cancel-operation').textContent = 'Pause migration';
  const result = await api.run('migration-run', {workspace: state.workspace.handle, checkpoint: state.library.checkpoint});
  state.library = result; state.paused = result.paused === true; state.progress = null;
  if (result.paused && result.verification_pending) {
    pendingReview(); recovery('Paused while verifying. The checkpoint is retained, but saved records and findings are not yet verified. Choose Resume full migration, or Refresh review explicitly; either verifies the library before presenting findings.');
    status('Paused while verifying; checkpoint retained. Resume or Refresh review explicitly to verify findings.'); return;
  }
  await review();
  if (state.library.expired) return;
  recovery(state.paused ? 'Paused at a saved checkpoint. Choose Resume full migration, or reopen this same library folder later with Resume library. No source re-import is needed.' : state.library.complete ? 'Processing finished. Review records and findings, redact selected fields if needed, then save reviewed portable files.' : 'Processing stopped before completion. Use Resume library to verify the latest saved checkpoint before continuing.');
  const omitted = (state.library.preserved_only_units || 0) + (state.library.partially_normalized_units || 0) + (state.library.record_omissions || 0);
  const notices = (state.library.missing_source_fields || 0) + (state.library.intentional_redactions || 0) + (state.library.reference_notices || 0);
  status(state.paused ? 'Paused safely at the saved checkpoint. Resume full migration now or reopen this library later.' : state.library.complete ? omitted ? 'Finished with omissions. Review preserved-only data and all record omissions before sharing.' : notices ? 'Processing finished with source-data notices or intentional changes. Review the separate finding counts before sharing.' : 'Processing complete for the selected export. Review all records and omissions before sharing.' : 'Processing stopped before completion. Review the saved checkpoint before resuming.');
}));
$('refresh-review').addEventListener('click', () => perform('Verifying snapshot, checkpoint and record hashes…', async () => {await review(); state.progress = null; if (!state.library.expired) {recovery(state.library.complete ? 'Saved records and findings are verified. Review their content before saving portable files.' : 'Saved records and findings are verified. Choose Resume full migration to continue processing from the checkpoint.'); status('Local integrity checks passed. Review content and omissions; hashes do not establish author identity.');}}));
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
  recovery('Choose an export and a new library location for another migration, or use Resume library to reopen an existing one. Previous libraries remain unchanged.');
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
    if (progress.verification_pending) pendingReview();
    if (state.library && progress.checkpoint) state.library.checkpoint = progress.checkpoint;
    if (progress.paused) state.paused = true;
    renderProgress();
  }
  const count = progress.snapshot_bytes === undefined ? progress.processed_records === undefined ? '' : ` · ${progress.processed_records} records processed` : ` · ${(progress.snapshot_bytes / 1048576).toFixed(1)} / ${progress.source_bytes === undefined ? 'unknown' : (progress.source_bytes / 1048576).toFixed(1)} MiB copied`;
  const label = progress.operation === 'migration-plan' ? 'Preparing selected export snapshot' : 'Automatic local migration';
  status(`${label}: ${progress.phase}${count}${progress.checkpoint ? ' · checkpoint saved' : ''}`);
});
formatGuidance();
api.status().then(result => {
  $('setup-help').textContent = result.ready ? `Local runtime ready: Python ${result.python}. ${result.platform === 'win32' ? 'Use local fixed NTFS locations; network paths, OneDrive placeholders and junctions are unsupported.' : 'Use an ordinary local folder you can access.'} No account sign-in or runtime download is needed.` : 'Python 3.11+ must already be installed. On Mac, the app checks /opt/homebrew/bin/python3, /usr/local/bin/python3 and /usr/bin/python3. On Windows, install 64-bit Python and make its launcher or executable available. Install it yourself from python.org, then reopen this app. Nothing is downloaded automatically.';
  $('runtime').textContent = result.ready ? `App ${result.version} · Python ${result.python}` : 'Python 3.11+ is required';
  if (!result.ready) status('Install Python 3.11 or newer from python.org, then reopen the app. This app never downloads a runtime silently.', true);
}).catch(error => {$('setup-help').textContent = 'Runtime status could not be checked. Reopen the app after checking your installed Python 3.11+ runtime.'; status(error.message, true);});
