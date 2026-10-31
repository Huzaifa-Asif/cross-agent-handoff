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
- `read_file(path) -> bytes`, `write_file(path, data)`, `purge_file(path)`: POSIX no-follow operations. Writers exclusively create private-mode files. The CLI uses these routines; callers must not replace them with unsafe loaders when handling untrusted selections.

## Versioning

Tool version 0.3.0; wire `schema_version` is `1.0`. Unknown keys/versions are errors, not ignored extensions. A future provider-specific adapter must preserve the full neutral object, use explicit activation, provide an official-source capability record and pass round-trip tests. Generic v2 target labels do not establish provider-specific capability; they carry only unverified routing presentation. Import returns the bundle without the label. Old releases do not parse v2; the new release continues parsing frozen v1 built-in envelopes. Native provider transcripts and archive formats need separate design/review; do not overload this parser.

All evidence collections have at most 256 records; text at most 32,768 Unicode characters; serialized inputs and outputs at most 1 MiB. Pretty Markdown overhead means a JSON bundle near the maximum may validate but fail export. That is a checked failure, not truncation. For long context, summarize explicitly and record omissions; this tool does not silently trim it.
