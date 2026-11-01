# Security policy

The tool handles untrusted files. Report path handling, output overwrite, parser resource exhaustion, redaction, unintended execution/network activity, or trust-boundary flaws privately to hello@huzaifa.io with subject `Cross-Agent Handoff security`. Use a synthetic minimal reproduction, version/commit and runtime; never include tokens, real histories or company/customer data. Do not disclose unpatched vulnerabilities in public issues.

Provider-specific export layouts remain version-dependent; no service-level response time or security certification is promised. Imported claims are not verified facts. Redaction is user-selected, not guaranteed secret discovery. Expiry is a signal and named-file purge is not secure erasure. No native vendor authentication or automatic execution exists. File hashes are context, not signatures. See README for supported limits and threat boundaries.


The migration workflow snapshots only selected exports and never extracts archive-controlled paths to disk. Size/count/depth/compression limits, descriptor-relative no-follow I/O, explicit checkpoints, private file modes and local locks bound processing. Redaction does not scrub original snapshots or previous revisions; raw-source export is refused after normalized redaction.

The desktop renderer is sandboxed with context isolation, a restrictive CSP, text-only imported content and allowlisted IPC to the shared local Python engine. No AI-account sign-in, telemetry, remote content or imported command execution is supported. Signing/notarization and OS security prompts remain platform gates; do not bypass them.
