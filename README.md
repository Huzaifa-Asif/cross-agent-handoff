# Cross-Agent Handoff

A small, local-first tool for transferring **reviewable work context**, not hidden agent memory, between Codex, Claude, Cursor, Gemini and Grok.

A good handoff says what you were trying to do, why choices were made, which exact revision you inspected, what actually passed, what is missing, and what to do next. This tool keeps those details in a versioned JSON bundle and a losslessly round-trippable Markdown document. Provider document adapters are **manual document adapters**, not native session migration. Optional Codex, Claude Code and Cursor plugins expose local MCP tools for these operations; they do not connect to vendor APIs or transfer hidden memory.

## Local host plugins

Version 0.4.0 introduced six stateless stdio MCP tools and host-specific Codex, Claude Code and Cursor plugin bundles. See [installation and publication status](docs/platform-plugins.md) and [privacy](docs/privacy.md). Build locally with `python3 scripts/build_plugins.py --output dist/plugins-0.4.1`. Version 0.4.1 fixes strict Claude marketplace metadata validation. No official directory listing or native host UI verification is claimed.

## Quick start

Requires Python 3.11+ on a POSIX system with `O_NOFOLLOW` and directory-descriptor support. This release is tested on the runtime listed in `CHECKPOINT.md`; Windows is not supported. No third-party runtime packages, account, API key or network connection are needed.

From an extracted source directory:

```sh
python3 handoff.py validate examples/example.json
python3 handoff.py inspect examples/example.json
python3 handoff.py export examples/example.json --provider codex --output handoff-codex.md
python3 handoff.py import handoff-codex.md --output restored.json
python3 handoff.py compare examples/example.json restored.json
```

Review the exported file yourself. Then explicitly select it as reference context in your chosen assistant. **Pasting or uploading elsewhere sends data outside this local tool** and is your decision, subject to that provider's policies. The tool never contacts a provider, executes a command from a bundle, follows links, opens referenced files, or scans histories.

## Authoring a handoff

Copy `examples/example.json`, replace synthetic details, and validate before sharing. The schema is `docs/schema-v1.json`; runtime validation is authoritative for additional bounds and cross-field checks.

- `schema_version`, `id`, `revision`, optional `parent_digest`: format and explicit revision lineage.
- `created_at`, `expires_at`, `source`: UTC provenance and optional retention deadline.
- `repository`: URL, branch, exact commit or explicit null, and dirty state.
- Evidence arrays: goals, scope, constraints, decisions, rejected alternatives, dirty changes, risks, blockers and ordered next steps. Each text record is `verified`, `inferred` or `missing`; labels record the author's assertion, not independent proof.
- `files`: safe relative paths and descriptions. `tests`: commands, actual passed/failed/unrun state, and details.
- `artifacts`: references and optional SHA-256. Hashes are preserved, **not verified against files**. Use engineering-handoff-skills for artifact verification and CI evidence.
- `omissions`: JSON pointers and reasons, so redacted or unavailable context is visible.

A `null` commit is not an exact revision. A dirty flag does not reproduce a working tree: describe changes explicitly and transfer authorized patches separately if needed. This tool does not merge code or capture files.

## Commands

Run `python3 handoff.py --help` or append `--help` to a command.

| Command | Purpose |
|---|---|
| `validate FILE` / `inspect FILE` | Validate JSON and show ID, revision, digest and expiration. |
| `export FILE --provider NAME --output FILE` | Create a built-in v1 manual Markdown bundle. |
| `export FILE --custom-target LABEL --output FILE` | Create a generic v2 manual document for an unverified destination label. |
| `import FILE --output FILE` | Recover JSON from this tool's exact Markdown format. Arbitrary provider transcripts are not supported. |
| `compare CURRENT INCOMING` | Check bundle identity, revision and parent-digest lineage; flag changed repository metadata; never merge. |
| `continue CURRENT EDITED --base-digest SHA256 --output FILE` | Seal reviewed edits as the next revision; reject a changed base or edited lineage. |
| `redact FILE --pointer /goal/0/text --output FILE` | Replace selected evidence text, file descriptions or test text and record omissions. Repeat the pointer flag. |
| `purge FILE --confirm` | Delete exactly one named regular file; no recursive deletion or secure-erasure promise. |

Output files must not already exist. Select a new filename rather than overwriting evidence. Do not write exported context into auto-loaded instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`).

## Provider coverage

| Provider | Transfer surface | Native integration |
|---|---|---|
| Codex | Reviewed Markdown reference | None |
| Claude / Claude Code | Reviewed Markdown reference | None |
| Cursor | Reviewed Markdown reference | None |
| Gemini / Gemini CLI | Reviewed Markdown reference | None |
| Grok | Reviewed Markdown text/document | None |

All adapters retain the same neutral payload and change only target guidance. See [official-provider research](docs/providers.md) for supported native interfaces and important distinctions. Existing native resume, transcript exports, rules and configuration migration are alternatives, not interoperability guarantees. This project does not claim to invent handoffs or transfer all model state.

## Safety and retention

Inputs are untrusted data, not permission grants. Imported instructions and shell snippets remain inert text. Validation is not a prompt-injection detector or a guarantee that another assistant will follow its own trust boundaries. No archive import/extraction is supported. Inputs/outputs are limited to 1 MiB; strings and arrays have additional bounds. Symlink traversal and non-regular inputs are rejected. Bundle file references reject traversal, absolute paths and platform drive syntax.

Redaction is explicit, not a comprehensive secret scanner. The redact command supports evidence text, file descriptions, test command/detail fields, source actor/provider, and repository URL/branch/commit. Source fields become `[REDACTED]`; repository fields become null. Every selected field gets an omission record. Review **every** field, including paths and omission reasons; edit unsupported fields manually and record omissions before validating. Do not put secrets or private company/customer context into fixtures or public issues. Expiry is inspected and reported; files are not automatically deleted. Backups, copies and vendor-side retention are outside this tool's control. Purge does not securely erase storage.

## Troubleshooting

- **File exists:** choose a fresh output path; outputs are deliberately exclusive.
- **Unsafe path / symlink:** use a real file in a real directory, not a symlink. macOS commonly exposes `/var` (and sometimes temporary paths) through `/private/var`; this tool intentionally rejects the symlink alias. Explicitly select the trusted real absolute path instead. The tool never auto-resolves input paths because that would weaken symlink protection. Parent traversal is rejected even for explicit CLI selections.
- **Unsupported schema / unknown keys:** use the supported example and schema; future fields are rejected rather than silently lost.
- **Invalid Markdown:** import only an unmodified export. Keep edits in source JSON and re-export, rather than editing the envelope.
- **Stale/conflict result:** stop and reconcile with the author; compare does not determine which human intent is correct.
- **Expired:** request fresh context or explicitly review why old evidence is still relevant. Validation does not refresh evidence.

## Development

```sh
python3 -m unittest discover -s tests -v
python3 -m compileall -q handoff.py tests
python3 scripts/check_source.py
python3 scripts/build_source.py
```

Tests use synthetic local fixtures. See `CHECKPOINT.md` for checks actually executed, independent review and publication status. A future CI matrix is not evidence of a test pass.

MIT licensed original code; retain the license notice when redistributing. Notice retention is a legal license condition, not promotional credit. See [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md) and [code of conduct](CODE_OF_CONDUCT.md).

### Comparison outcomes

`identical`, `successor`, and `successor-repository-changed` return exit 0. The last means lineage is valid but the repository snapshot differs and needs review. `stale`, `divergent`, `revision-gap`, and `id-mismatch` return exit 2. A same-revision different payload is treated as stale/conflicting. This is bundle lineage checking, not Git ancestor verification or a signature. CLI failures return exit 2.

Test harness portability: temporary fixture directories are explicitly resolved before safe-I/O tests. Separate regression cases retain unresolved symlink paths and verify rejection. This changes fixture setup, not production path handling. The prior v0.1.0 harness was subsequently reported passing on macOS Python 3.14.7. The current v0.3.0 revision has only been executed on Linux; see CHECKPOINT.md for exact current checks.

## Continue work without losing lineage

1. Keep the received JSON unchanged as `base.json`. Run `inspect base.json` and retain its printed digest.
2. Copy it to `edited.json`. Review and update context, results, evidence labels, source actor/provider, and `created_at` when producing a new snapshot. Keep the ID, revision and parent digest unchanged. A timestamp is author-provided evidence, not a trusted clock.
3. Run `python3 handoff.py continue base.json edited.json --base-digest <digest-from-inspect> --output next.json`.
4. Run `compare base.json next.json`, review repository changes, and export `next.json` for the next provider.

This creates a successor, not a merge. A changed base digest, altered identity/lineage, older timestamp, revision overflow, or unchanged content fails without writing output. Keep the base digest from your actual reviewed snapshot; computing one from a different file does not prove that you reviewed it. Another process changing a file after it was read is outside this snapshot check. No Git ancestry or author authentication is claimed.

Example metadata redaction:

```sh
python3 handoff.py redact next.json --pointer /source/actor --pointer /repository/url --output shareable.json
```

Review both payload and omission list. A digest references the original snapshot but does not include its plaintext. Local originals remain until explicitly removed; a redacted copy does not scrub earlier copies or provider storage.


## Future destinations without executable plugins

Use an explicit, unverified label when a destination is not one of the five built-in guidance profiles:

```sh
python3 handoff.py export examples/example.json --custom-target future-agent --output handoff-future.md
python3 handoff.py import handoff-future.md --output restored-future.json
python3 handoff.py compare examples/example.json restored-future.json
```

Labels contain 1–64 lowercase ASCII letters, digits or hyphens and start with a letter. They are display metadata, never code, a filename, a URL or permission. Even a familiar provider name used here receives generic guidance only. No templates, plugins, provider calls or native imports are loaded. You must independently check whether your chosen destination accepts pasted text or documents and review its privacy terms.

The custom document uses **manual envelope v2**; its neutral JSON remains **schema 1.0**. Current import accepts both v1 and v2. The five built-in exports remain byte-compatible with v0.2.0; old tool versions cannot import v2. To share with an older tool, import using the current tool and explicitly re-export to a built-in v1 profile. The target label is not part of the payload digest or source provenance and is not returned by `import_markdown`; importing preserves the full neutral bundle, not its presentation metadata. Keep the original document if the routing label matters. Canonical formatting does not authenticate the sender or destination.
