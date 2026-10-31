# Cross-Agent Handoff checkpoint — 2026-10-31

## Source and verification state

Version 0.3.0 source snapshot. Neutral wire schema 1.0 is unchanged. The scope is cross-agent context transfer and adapter fidelity. Artifact/CI evidence verification is a separate concern. There is no npm package or hosted service.

Implemented: explicit `export --custom-target LABEL` generic manual v2 envelope; strict bounded ASCII labels and fixed safety guidance; v1/v2 import; direct-string UTF-8 byte-limit and invalid-Unicode checks. Five built-in v1 provider exports remain frozen and byte-compatible. A label is unverified presentation metadata, not provider support or identity, and is not included in the bundle digest or returned by import. Old releases cannot import v2.

Implementation and tests match the independently reviewed local v0.3.0 candidate. Public-source preparation only changes documentation and omits unpublished launch-design drafts; it does not change runtime code or tests.

## Verification actually executed

- Linux Python 3.12.14 and 3.13.5: all 29 unit/integration/CLI methods passed, including frozen v1 hashes, custom labels, canonical corruption, continuation/redaction and safe-output journeys.
- Included review probes: 500 deterministic adversarial round trips per runtime.
- Independent reviewer: 1,000 custom/built-in round trips and 3,000 malformed-envelope rejections per runtime; prior-commit v1 mutual compatibility; byte/type/lineage/symlink/instruction-path probes. No implementation blocker. Clarified API wording that only noncanonical header edits are rejected; a valid changed target label is not authenticated.
- Python compileall, syntax/whitespace checks, git diff whitespace check, Draft 2020-12 schema meta-validation and synthetic example validation passed.
- Source archive build/extracted-source verification and exact commit are recorded in the run report after final packaging.
- No static type checker installed/run. Syntax checks are not typing. Zero third-party runtime dependencies; no external vulnerability-audit claim.
- Current revision not run on Windows (unsupported), macOS or Python 3.11. Remote CI is authored but unrun because nothing was pushed. No provider UI/API integration test.

## Safety and provider research

Five official provider documentation surfaces rechecked October 31; details in docs/providers.md. All built-ins and custom labels are manual document surfaces. No private histories, account sessions, credentials, employer code or customer context accessed. Synthetic fixtures only. Inputs never grant authority; imported instructions are inert. No network calls, archive import, Git capture, referenced-file following, plugin/template execution, or native session migration.

Redaction remains explicit selected-field removal with omissions, not a comprehensive secret detector. Originals remain. Expiration is informational; purge is an explicit named-file deletion, not secure erasure. Digests prove payload equality/lineage, not artifact correctness or author/destination identity.

## Remaining verification

- Verify the published commit and its CI results before relying on hosted checks. A workflow definition is not evidence of a successful run.
- Extend runtime coverage when a suitable environment is available; historical macOS results do not validate this revision.
- Expand provider-specific integration only with current official evidence and permission. Generic labels alone do not establish support.

See the repository's commit history and Actions page for subsequent publication and CI evidence. This checkpoint records local verification, not a claim that a receiving assistant executed or trusted a handoff.
