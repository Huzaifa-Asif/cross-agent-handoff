# Python API and wire format

`import handoff` imports a side-effect-free standard-library module. API calls raise `HandoffError` for invalid bundles; filesystem operations may raise `OSError`. CLI converts expected validation/filesystem failures to exit 2. The CLI never evaluates bundle commands.

- `validate(bundle) -> bundle`: strict structural and semantic checks; does not mutate or attest truth.
- `parse_json(data) -> dict`: bounded UTF-8 JSON, duplicate/nonfinite-key handling and validation.
- `canonical(bundle) -> bytes`: compact sorted UTF-8 JSON serialization; low-level, does not itself validate. Use validated objects.
- `digest(bundle) -> str`: validated canonical SHA-256; not a signature or artifact-file verification.
- `export_markdown(bundle, provider) -> str`: validated pretty JSON in a dynamic backtick fence, with provider-specific manual guidance. Targets: `codex`, `claude`, `cursor`, `gemini`, `grok`.
- `export_custom_markdown(bundle, target) -> str`: generic manual v2 envelope with a bounded unverified ASCII destination label and fixed safety guidance. The label does not alter payload/source provenance.
- `import_markdown(data) -> dict`: accepts only exact regenerated v1 built-in or v2 generic envelopes. Noncanonical header edits, trailing content and noncanonical formatting are rejected. Arbitrary Markdown/transcripts are not accepted.
- `compare(current, incoming) -> str`: identity, equality, monotonic revision and exact-parent digest checks; reports changed repository metadata on valid successor. Does not query Git or select a winning conflicting revision.
- `continue_bundle(current, edited, base_digest) -> dict`: bind reviewed edits to the exact base digest, preserve identity, reject changed lineage/no-op/older time, then increment revision. Never merges or executes content.
- `redact(bundle, pointers) -> dict`: deep copy, replace supported text/source fields with `[REDACTED]` and selected repository metadata with null, append omissions, increment revision and link original digest. Unselected source timestamp/provenance remain authored metadata; caller must update provenance when appropriate. Original remains untouched.
- `expiration(bundle, now=None) -> str`: `active`, `expired`, or `no-expiration`. Optional `now` must be timezone-aware. No background retention worker.
- `read_file(path) -> bytes`, `write_file(path, data)`, `purge_file(path)`: On macOS/Linux, POSIX no-follow operations; the unreleased Windows candidate uses checked local NTFS handles and rejects unsupported paths/reparse points. Writers exclusively create files with the platform’s checked access controls. The CLI uses these routines; callers must not replace them with unsafe loaders when handling untrusted selections.

## Versioning

Tool version 1.0.0 accepts task `schema_version` 1.0 and 2.0. `new_task(goal, provider, domain, context, preferences)` creates schema 2.0 with optional code fields. Unknown keys/versions are errors, not ignored extensions. A future provider-specific adapter must preserve the full neutral object, use explicit activation, provide an official-source capability record and pass round-trip tests. Generic v2 target labels do not establish provider-specific capability; they carry only unverified routing presentation. Import returns the bundle without the label. Old releases do not parse v2; the new release continues parsing frozen v1 built-in envelopes. Native provider transcripts and archive formats need separate design/review; do not overload this parser.

All evidence collections have at most 256 records; text at most 32,768 Unicode characters; task JSON and exported Markdown inputs/outputs at most 1 MiB. Pretty Markdown overhead means a JSON bundle near the maximum may validate but fail export. That is a checked failure, not truncation. For long context, summarize explicitly and record omissions; this tool does not silently trim it.

## Saved-task CLI review

`inspect FILE` and `validate FILE` keep their metadata-only JSON output: `id`, `revision`, `digest` and `expiration`. Only `inspect FILE --include-content` adds `bundle`, the complete validated schema 1.0 or 2.0 object from the same read. It does not fill missing optional fields, convert schemas, redact data or modify the file. `validate` rejects `--include-content`. This opt-in JSON transport includes metadata and Unicode escaping, so its byte length can exceed the 1 MiB bundle limit; the bundle itself remains bounded and is never truncated.

`export FILE --expected-digest SHA256` optionally requires an exact lowercase 64-character canonical SHA-256 from the reviewed snapshot. Both built-in `--provider` and generic `--custom-target` exports check the same already-parsed bundle before rendering or creating output. A malformed digest or changed content exits 2 without creating or changing the destination. Formatting-only changes preserve the canonical digest. Omitting the flag preserves the existing export behavior. This is a stale-content guard, not authentication, a file lock or a change to informational Task Hand Off expiry.

## Migration engine

`migration.py` is a separate local-filesystem API and CLI (macOS/Linux, plus the unreleased Windows NTFS candidate), never overloaded into the inline task MCP tools. Its primary functions are `plan`, bounded `run`, automatic `auto_run`, `review`, `show`, `search`, `redact`, `export`, `verify_export` and `purge`. Mutating run/redact/export calls require an exact reviewed checkpoint digest; migration/source/record digests are integrity checks, not authentication. Full Migration expiry blocks run, redaction and export; read-only review/show/search and explicit purge remain available. Redaction checks expiry before and after integrity verification, and immediately before publishing its revision.

See [migration format, parsing coverage and bounds](migration.md). CLI stdout is the final JSON result; migration progress is bounded NDJSON on stderr. Graceful pause returns exit 130 and a checkpoint. Exit 2 means a checked input, stale-state, integrity, bounds or local-filesystem failure. A partial plan/export directory can remain after interruption; success is not claimed until the command finishes. Raw originals and old normalized revisions remain local until explicit purge.
