# Independent review — Cross-Agent Handoff

Review date: 2026-10-29. Synthetic-only local review; no external writes, provider uploads, private histories, or publication. Reviewed latest pretty-JSON/manual-provider-guidance candidate. Implementation was not modified by reviewer.

## Recommendation

**APPROVE experimental source release from a runtime-safety perspective. Both low-severity findings below are now resolved and independently rechecked.** No high/medium-severity runtime vulnerability was found in this bounded review. This is not a security certification or authorization to publish. Final correction recheck passed; packaging/extracted-archive and remote-publication verification are separate checks.

## Final correction recheck — 2026-10-29

- All **16/16** unit/integration methods passed on Python 3.12.14, including the new newline-path schema regression and AGENTS.override.md/CLAUDE.local.md case-insensitive output refusals.
- Independent probes rerun: all passed, including **500** adversarial provider round trips.
- Draft202012Validator with format checking: schema meta-validation and example passed; both files/artifacts paths now reject both `a\n/../x` and `a\n:b` (four regression cases).
- CHECKPOINT.md now exists and distinguishes actual local checks, intended CI, untested platforms, manual provider boundaries, and not-yet-published status. Its next-action/final-rerun entry should be updated when maintainer packaging work concludes.
- README now explicitly documents all compare exit codes, changed-repository review requirement, no Git ancestry/authorship guarantee, and redaction field limits.
- No unresolved blocking or low-severity findings from this review. Historical findings below retained as audit history and marked resolved.
- Final schema SHA-256: `87b3a92f83e9f4406d020882ed558c76e5fecc6fd66f1b609ec1c86bc7be6c02`. Final handoff.py SHA-256: `6e9911872b911594f08bbdea22c0ccb271c7092efde6ef1ea9b661f57be5c07a` (includes added instruction-name hardening; tests and independent probes rerun afterward).

## Actual evidence

- Runtime: **Python 3.12.14**, POSIX.
- `python3 -m unittest discover -s tests -v`: **14/14 passed**, including all provider CLI round trips, redaction, size bounds, duplicate keys, invalid Unicode, stale/conflict checks, FIFO/symlink rejection and explicit purge.
- `python3 -m compileall -q handoff.py tests`: passed.
- `python3 scripts/check_source.py`: passed syntax/whitespace checks; this is **not a static type check**.
- Independent executable probe: `scripts/review_probes.py` (packaged path adjusted by maintainer; re-executed); **all passed** against updated multiline Markdown implementation.
- 500 deterministic adversarial round trips across five providers, with literal backticks, newlines, CR, U+2028/U+2029, emoji, quotes, backslashes, NUL and instruction-like text: payload equality preserved.
- Malformed UTF-8, concatenated JSON, raw NUL, deep nesting and an oversized integer: rejected. Oversized integer raises built-in ValueError at library level; CLI handles it cleanly.
- Parent-directory symlink, explicit `..`, FIFO, and case-varied instruction filenames: rejected. Synthetic unrelated target bytes remained unchanged.
- Synthetic `touch SENTINEL` command plus malicious instruction text: export/import/inspect succeeded with exact text preservation, and sentinel was not created. Source inspection found no shell execution, network requests or referenced-file loading.
- Redaction: selected evidence becomes `[REDACTED]` with `missing` status, omission and parent digest; original object unchanged. Provenance/URLs remain unchanged and `/source/actor` is rejected by redact. README now correctly documents this limitation.
- Compare detects structural lineage, staleness, divergence, gaps and changed repository metadata. Source actor change alone can be a `successor`; this is not authenticated authorship. Author labels/hashes are not signatures.
- Expired bundles report `expired` and remain exportable, consistent with documented informational expiration. No automatic deletion or secure-erasure claim.
- JSON Schema is structurally valid under Draft 2020-12; example accepted with format checking enabled.

## Findings

### RESOLVED LOW — JSON Schema path regex misses prohibited segments after newline

Both `files[].path` and `artifacts[].path` use negative lookaheads containing `.*`, which does not cross a newline. Reproduction with `jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())`:

- Set `files[0].path` to `a\n/../x`: schema accepts; runtime `validate` rejects.
- Set `files[0].path` to `a\n:b`: schema accepts; runtime rejects.
- Ordinary `../x`, `a/../x`, `/x`, `C:/x`, backslashes and NUL are rejected by both.

Impact: schema-only editors/consumers can mark a bundle valid that the authoritative CLI rejects. **No CLI path-traversal bypass**: bundle references are not opened and runtime checks are stricter. Recommendation: use `[\s\S]*` instead of `.*` in relevant lookaheads, and add schema/runtime parity regression tests. Runtime-authoritative disclaimer mitigates but does not eliminate avoidable schema inconsistency.

### RESOLVED LOW — Release evidence reference must exist before packaging

README references CHECKPOINT.md for actual runtimes, independent review and publication status; that file was absent at review time. The final source snapshot contains this file. Ensure final package contains it and reports actual checks, not merely planned CI. README currently does not spell out that `compare` returns exit code 0 for `successor-repository-changed`; document this if scripts may consume the result.

## Scope limits / non-findings

- No stress test of adversarial concurrent filesystem rename races, disk exhaustion, hostile kernel/filesystem, or other operating systems.
- `purge` acts on the explicitly named regular file; it does not validate bundle contents, automatically enforce expiry or erase backups. This is consistent with command documentation.
- JSON payloads preserve semantic values, not original whitespace, key order, escape spelling or byte-identical source JSON. Exact Markdown import intentionally rejects hand edits and unknown formats.
- Redaction is not comprehensive secret removal, provenance authentication or cryptographic erasure. Original bundle and copies remain; parent digest preserves lineage.
- Manual provider workflows were not exercised against vendor UIs. Prompt-injection inertness here describes this CLI only, not downstream assistant behavior.
- No independent Python 3.11/3.13 execution by this reviewer; broader runtime verification is separate.

Reviewed file SHA-256 values (before any subsequent corrections):

- handoff.py: `f333ee1e4d1793279c57c15e71b1bb773c75b1aad380e6151aee950219bccfc2`
- README.md: `94e93503da877356cdf450a718fc6cde6c0c7403a1e8313447d1d2cbf8adb234`
- docs/schema-v1.json: `ae5e3083be8983aac8f886a8b74df1293a86b458a379045c0abcc474b06d6ba3`
