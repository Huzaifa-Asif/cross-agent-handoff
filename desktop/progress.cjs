'use strict';
const PHASES = new Set(['checking','snapshot','planned','processing','batch-complete','complete','complete-with-omissions','complete-with-notices','paused','error']);
const FINDING_COUNTS = ['record_omissions','missing_source_fields','intentional_redactions','reference_notices'];
const COUNT_FIELDS = ['batch_number','processed_units','total_units','processed_records','total_records','omitted_units','snapshot_bytes','source_bytes',...FINDING_COUNTS];
function sanitizeProgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.event !== 'migration-progress' || !PHASES.has(value.phase)) return null;
  const result = {event:'migration-progress',phase:value.phase};
  for (const field of COUNT_FIELDS) {
    if (value[field] === null && field === 'total_records') result[field] = null;
    else if (Number.isSafeInteger(value[field]) && value[field] >= 0 && value[field] <= 2 ** 40) result[field] = value[field];
  }
  if (typeof value.checkpoint === 'string' && /^[a-f0-9]{64}$/.test(value.checkpoint)) result.checkpoint = value.checkpoint;
  result.complete = value.complete === true;
  result.paused = value.paused === true;
  result.planning_cancelled = value.planning_cancelled === true;
  result.workspace_may_be_incomplete = value.workspace_may_be_incomplete === true;
  result.progress_percent = typeof value.progress_percent === 'number' && Number.isFinite(value.progress_percent) && value.progress_percent >= 0 && value.progress_percent <= 100 ? value.progress_percent : null;
  if (result.phase === 'complete-with-omissions' || result.phase === 'complete-with-notices' || FINDING_COUNTS.some(key => (result[key] || 0) > 0) || result.phase === 'error' || (result.progress_percent === 100 && (result.phase !== 'complete' || !result.complete || result.paused)) || (result.omitted_units || 0) > 0) result.progress_percent = null;
  return result;
}
module.exports = {sanitizeProgress};
