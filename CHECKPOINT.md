# Cross-Agent Handoff 0.4.1 verification checkpoint

Checked 2026-10-31. This patch adds the Claude marketplace description to the source generator and synchronizes package versions. Handoff behavior and schema are unchanged.

## Patch verification

- 43 unit/integration/CLI/package test methods passed on macOS Python 3.14.7, including a regression for the generated Claude marketplace description and host manifest/archive version consistency.
- Claude Code 2.1.220 strict native validation passed for the generated plugin and marketplace. This fixes the missing-description warning found in v0.4.0.
- Deterministic source/plugin rebuilds, generated marketplace parity, syntax/whitespace checks and compileall passed. No external vulnerability-audit or static type-check claim.
- Codex CLI 0.165.0 and Claude Code 2.1.220 installed/listed v0.4.0 in disposable configuration directories. Claude inventory found the skill and MCP server; direct cached-runtime protocol discovery and synthetic validation passed. Test installations were removed. This is historical v0.4.0 evidence, not a v0.4.1 desktop/model workflow claim.

## Published baseline

v0.4.0 source commit `a254a6f380f26d975b0c15fb068f6e2abe32a067` is public at https://github.com/Huzaifa-Asif/cross-agent-handoff. All six exact-commit CI jobs passed on Ubuntu/macOS with Python 3.11, 3.12 and 3.13: https://github.com/Huzaifa-Asif/cross-agent-handoff/actions/runs/41227918671. The v0.4.0 tag and assets remain unchanged. Consult the v0.4.1 release and its exact-commit Actions run for patch publication evidence; this source checkpoint does not pre-claim future CI.

## Earlier checks

The v0.4.0 checkpoint records Linux Python 3.12/3.13 tests, independent malformed-input and round-trip probes, official MCP SDK protocol checks, portable schema checks and isolated Codex CLI 0.166.0-alpha.1 package installation.

## Remaining gaps

Cursor 3.20.21 is installed, but native plugin loading is untested. All desktop clean-install and model-driven workflows remain unrun. Windows is unsupported by the manual CLI safe-I/O contract. No official directory submission, eligibility, review or listing is established. Claude and Cursor submission portals require sign-in; OpenAI desktop-only submissions require approved-partner eligibility, organization allowlisting and identity verification. Host data handling and model obedience are outside the local server's guarantees.

## Distribution

Build source and plugins with the documented scripts. Use the generated marketplace on the separate distribution branch for host installation; the main branch is source build input. See docs/platform-plugins.md for installation and separate directory publication requirements. Use synthetic fixtures for validation.
