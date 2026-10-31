# Changelog

## 0.4.0 — 2026-10-31

- Add bounded stateless stdio MCP validate/export/import/compare/continue/redact tools operating only on explicitly supplied text.
- Add Codex, Claude Code and Cursor plugin manifests, guided skill, deterministic standalone bundles and local marketplace catalogs.
- Add protocol, privacy, invalid-input, package parity and complete handoff journey tests.
- Preserve schema 1.0 and all five manual export formats. No vendor API connection, native session migration or directory publication implied.


## 0.3.0 — local candidate, 2026-10-31

- Added explicit generic manual destination labels through `export --custom-target`, without executable plugins or provider connections.
- Introduced a strict manual v2 envelope; unchanged payload schema 1.0 and frozen built-in v1 export compatibility.
- Hardened direct text import to enforce UTF-8 byte limits and reject invalid Unicode with a controlled error.
- Added synthetic target validation, corruption, backward-compatibility, CLI and cross-envelope continuation/redaction journeys.
- Five built-in profiles plus generic manual labels, not additional tested providers. No push or publication.

## 0.2.0 — local candidate, 2026-10-30

- Added exact-base continuation sealing, with stale/identity/lineage/no-op/overflow checks and five-provider CLI round-trip tests.
- Added explicit redaction of source actor/provider and repository URL/branch/commit, preserving omission reports.
- Fixed reserved-directory output guards for relative paths from an auto-loaded configuration directory.
- Fixed JSON Schema end anchors to reject final-newline IDs, commits and digests consistently with runtime validation.
- Rechecked five official provider documentation surfaces. All adapters remain manual document transfers.
- No public repository, push, remote CI, native integration or registry publication.

## 0.1.0 — candidate

- Original provider-neutral schema with explicit evidence state, revision lineage and retention metadata.
- Offline JSON/Markdown round-trip and five manual provider targets.
- Strict validation, bounded reads, no-follow paths and exclusive output.
- Explicit redaction with omissions, revision comparison and named-file purge.
- Trusted test-fixture temporary roots resolved explicitly for POSIX symlink-prefixed temp directories; production symlink rejection unchanged.
- Synthetic regression and CLI tests; see CHECKPOINT for actual results.

Not a live integration, provider-native importer, artifact verifier, or npm release.
