# Privacy and retention

Cross-Agent Handoff's local MCP process handles only the inline strings explicitly supplied to its tools. It does not read files, scan agent histories, follow URLs, open credentials, run imported instructions, call network services or persist request data. It emits no payload logs. Process memory is released normally; secure erasure is not promised.

Your assistant host receives tool inputs and results and may send them to its model provider, retain them in conversation logs or apply organization policies. Installing a local server does not make the surrounding assistant offline. Manually pasting or uploading a handoff to another provider is a separate disclosure chosen by you.

Review all fields before sharing. Explicit redaction records omissions but is not a comprehensive secret scanner and does not remove earlier copies. Expiration metadata is informational; there is no automatic deletion. The standalone CLI can save or explicitly purge named files; the MCP server exposes neither capability. Backups and host/provider retention are outside this project's control.

The original project uses MIT licensing. No telemetry, ads, account system or paid API dependency is included. For non-sensitive support use the repository issues. Never attach private handoffs or credentials to a public issue.

## Deliberate migration and desktop application

Migration only reads the export file or ZIP the user explicitly selects. It copies original bytes into a private local workspace; those originals and older normalized record revisions can still contain secrets after redaction. Normal portable export excludes them. Explicit raw-source export is refused after normalized redaction. The selected export may omit vendor memory/settings/attachments; the tool cannot recover or infer missing state.

The desktop app runs the same local Python engine through restricted subprocess operations. It has no AI-account sign-in, telemetry or provider API client. Imported content is rendered as text. You still control whether to copy resulting documents to a provider; doing so changes where that data is held. A configured Full Migration expiry blocks processing, redaction and export after the deadline but does not delete files. Read-only review and explicit purge remain available. Purge is not secure erasure.
