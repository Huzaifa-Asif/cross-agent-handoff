# Independent review: Cross-Agent Handoff v0.3.0 candidate

Reviewed 2026-10-31 against baseline commit `225eb96f0f5bc324653479de989d6433a564569c`.
Implementation reviewed: `handoff.py` SHA-256 `d918970c7e4bcb81ec5a8ece0b14a533c872c667a5c63b35911f8a1441805d0a`.

## Outcome

No blocking implementation finding in the reviewed custom-envelope changes. This is a scoped static and synthetic runtime review, not a security certification, native-provider integration result, or publication approval.

The new route retains neutral JSON schema1.0 and uses an explicit generic manual v2 wrapper. Custom labels are bounded ASCII data, not loaded templates, paths, code, URLs, permissions or provider capability claims. The importer enforces canonical wrappers and bytes, retains untrusted content as inert data, and does not execute snippets or follow references. Existing no-follow/exclusive-output protections remain used by the CLI route.

## Checks independently executed

- All29 unit/integration/CLI tests passed on Linux Python3.12.14 and3.13.5.
- On each runtime:1000 synthetic Unicode/backtick/injection-shaped custom-to-built-in round trips,3000 malformed-envelope rejections, payload digest equality and no-input-mutation assertions.
- Compared built-in output directly with the prior committed implementation, not only fixture constants: five v1 exports byte-identical, old/new mutual imports preserve the example.
- Explicit UTF-8 byte-limit, surrogate, wrong-input-type, continuation/redaction lineage and stale checks passed.
- New CLI export route rejected symlinked output-parent paths, AGENTS.md and CLAUDE.md without creating them.
- Syntax/whitespace checks and compileall passed. These are not static type checking.
- Probe script: `../review-probes-oct31.py` (stdlib only, synthetic local data, no vendor/network operations).

## Documentation observation

README correctly states that custom label is unauthenticated presentation metadata, not included in the payload digest/source provenance and omitted on JSON import. A valid label can therefore be relabeled without changing the neutral payload. API wording “Header edits ... rejected” should be qualified as “noncanonical header edits”; otherwise it overstates tamper detection. Final checkpoint/source-build validation is a separate packaging check.

## Limits

No current macOS, Windows or Python3.11 runtime checked; no static type checker, remote CI or live vendor interaction. No authentication, origin validation, artifact-file verification, full prompt-injection detection or receiving-model compliance is established. Existing read/purge race caveats and retained originals remain outside this change’s guarantees. No external publication performed.

Documentation correction: corrected API wording to “Noncanonical header edits” after review. Implementation SHA-256 unchanged. The external probe script requires the local Git baseline and is retained with run evidence, not promised as a standalone source-archive test. Frozen-byte compatibility assertions remain in the shipped test suite.
