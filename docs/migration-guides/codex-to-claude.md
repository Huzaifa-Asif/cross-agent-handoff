# Codex to Claude

1. Export the Codex session as Markdown/text where possible. Internal Codex JSONL is experimental and can change.
2. Choose **Full Migration**, source **Codex**, then select **Documents** for exported text or **Codex JSONL (experimental)** only for a compatible file.
3. Process into a new local library and inspect every omission and parsed record.
4. Redact sensitive fields, select destination **Claude**, save the portable library, and verify it.
5. Attach the relevant reviewed references to a new Claude conversation. Do not install them as `CLAUDE.md` instructions.

This is reference transfer, not native Codex-session resume in Claude.
