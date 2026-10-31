# Cross-Agent Handoff 0.4.0 verification checkpoint

Checked 2026-10-31. This snapshot extends the public-safe 0.3.0 source with local host plugins. It does not establish public directory publication.

## Implemented

Six bounded, stateless stdio MCP tools for validate, export, import, compare, continue and redact. Tools process explicitly supplied inline text and have no file, network, command-execution or persistent-storage operations. Codex, Claude Code and Cursor packages share identical runtime bytes and a guided skill; built-in manual exports and schema 1.0 remain unchanged. Deterministic standalone archives and generated local marketplace catalogs are build outputs, not store listings.

## Checks executed

- 42 unit/integration/CLI/package test methods on Linux Python 3.12.14 and 3.13.5.
- Independent 1,000 injected-text roundtrips and 3,000 malformed-call rejections; strict UTF-8 regression and redacted errors verified.
- Official Python MCP SDK 1.29.0 verified initialize, six-tool discovery and three-provider roundtrips, including all extracted host packages. Official SDK 2.3.0 independently verified discovery and three-provider roundtrips.
- Codex CLI 0.166.0-alpha.1 added the generated marketplace, installed and listed v0.4.0 in an isolated temporary CODEX_HOME. No account authentication, model invocation or user configuration changes.
- Codex portable manifest/MCP configuration validated against official Agent Plugins 1.0 schemas. Deterministic archive bytes, exact runtime parity, safe members and package Markdown links tested.
- compileall and syntax/whitespace policy checks; no static type-check claim. Zero third-party runtime dependencies. No external vulnerability-audit claim.
- Independent review found two minor issues (non-UTF8 JSON acceptance and package-root README links); both fixed and retested.

## Not verified

Current macOS/Python 3.11 execution; Windows unsupported by the manual CLI safe-I/O contract. Claude Code native manifest validator, Cursor native installation and all desktop UI/model workflows remain unrun. Remote exact-commit CI, public repository availability, official directory eligibility/submission/review/listing are not established by local tests. Host data handling and model obedience are outside the local server's guarantees.

## Distribution and next steps

Build source and plugins with the documented scripts. Verify the actual published Git commit before using a repository URL, and publish the generated marketplace tree on a distinct distribution branch for direct host installation. The source tree itself is build input. See docs/platform-plugins.md for official dated references and separate publication gates. Never expose private handoff content to a provider merely to test installation.
