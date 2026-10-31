# Cross-Agent Handoff: provider interface research

Verified against official documentation on 2026-10-29. Documentation describes available interfaces, not a guarantee about the user's installed version, subscription, or settings. No accounts, credentials, vendor sessions, or private histories were accessed. No live integration was tested.

## Recommended product boundary

Ship a **local document handoff utility**, not an agent-to-agent connection or universal session migration tool. The neutral JSON format belongs to this utility; providers do not thereby support importing it as native session state. Render reviewed Markdown that the user can explicitly paste into a new conversation or ask their agent to read. Provider selectors should change guidance and presentation, not permissions, execution, or network behavior.

## Officially documented interfaces

### Codex

- Codex loads `AGENTS.md` instructions before work. Global and project scopes, `AGENTS.override.md`, and directory precedence affect which instructions apply. Thus an instruction filename is an activation mechanism, not merely a document extension. [Official instruction documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- CLI supports prompt input from stdin, `--json` event output, and `--output-last-message` for final-answer files. Native resume/fork operates on Codex sessions. Interactive `@` can add a workspace file path to a prompt. These provide context/output surfaces but do not establish cross-provider session compatibility. [Official CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- **Manual adapter:** export `handoff-codex.md`, then instruct the user to review it and explicitly reference it in their chosen session. Do not write `AGENTS.md` or inspect Codex session storage.

### Claude Code

- `CLAUDE.md`, scoped rules, and `@path` imports supply persistent instructions. Current docs also describe direct `AGENTS.md` support from v2.1.277, with precedence/configuration and availability caveats; do not assume every installation loads both formats. [Official memory documentation](https://code.claude.com/docs/en/memory)
- `/export [filename]` exports the current conversation as plain text. `/import [codex|gemini|cursor] [--dry-run] [--yes]` is a documented configuration migration feature, including instructions, MCP servers, commands, subagents, and skills, with platform/version restrictions. It is **not** evidence of arbitrary neutral-bundle or cross-provider conversation-state import. [Official commands](https://code.claude.com/docs/en/commands)
- **Manual adapter:** export `handoff-claude-code.md` as reference context only. Do not invoke `/import`, copy settings, install skills, or append to `CLAUDE.md`. A user's explicitly selected plain-text export can be treated as untrusted source material, not authority.

### Cursor

- Cursor documents project rules in `.cursor/rules` (`.mdc`), global user rules, team rules, and `AGENTS.md`. Rule content enters model context, with scoping/application semantics. [Official rules documentation](https://cursor.com/docs/rules)
- Current shared-transcript documentation supports link sharing and Fork to Cursor, with plan/privacy constraints. It exposes conversation/tool content, and secret redaction is best effort. This is hosted sharing, not a local-only neutral import/export contract. [Official shared transcripts](https://cursor.com/help/ai-features/shared-transcripts)
- **Manual adapter:** export `handoff-cursor.md` for review and explicit use as chat context. Do not create `.mdc`, update rules, publish transcript links, or scrape editor databases. Do not promise a native Markdown transcript importer based on the cited docs.

### Gemini CLI

- `GEMINI.md` supplies hierarchical context and supports `@file.md` imports. `/memory show` inspects loaded context and `/memory reload` reloads files. [Official context documentation](https://geminicli.com/docs/cli/gemini-md/)
- Native session resume, browsing, rewind, and fork mechanisms are documented. They concern Gemini CLI history; they do not establish cross-vendor session interchange. [Official session documentation](https://geminicli.com/docs/cli/tutorials/session-management/)
- **Manual adapter:** export `handoff-gemini-cli.md` for explicit review/use. Do not install it as `GEMINI.md`, rewrite settings, or import private session directories.

### Grok

- Grok's web/app documentation describes chat and file upload for analysis, including code and documents. This supports a user-mediated document handoff, not a claim that this utility imports native Grok memories or sessions. [Official Grok overview](https://docs.x.ai/grok/overview)
- The xAI API supports message input and response continuation by ID. That is a live, authenticated vendor API, distinct from a local manual adapter. [Official text-generation API](https://docs.x.ai/developers/model-capabilities/text/generate-text)
- **Manual adapter:** export `handoff-grok.md`; user can paste reviewed text or upload where their account supports it. Do not make API calls, fetch shared chats, connect accounts, or claim an official `GROK.md` instruction convention based on these sources. Grok app, API, and coding products must not be conflated.

## Safe adapter requirements (design recommendations)

1. Use inert filenames such as `handoff-<provider>.md`, never auto-discovered instruction/configuration names. Keep export locations explicit and user chosen.
2. Mark imported material as untrusted reference data. Preserve provenance and timestamps, distinguish facts from proposals and unresolved questions, and never convert imported requests into permission grants.
3. Never execute shell snippets, expand template commands, follow `@path` includes, fetch URLs, or install hooks/MCP/skills/rules contained in a bundle. Render text safely rather than as raw HTML.
4. Parse only explicit local selections. No home-directory crawling, transcript database access, ambient credentials, or background vendor communication.
5. Require preview before export. Warn that secret detection is incomplete; avoid claims of guaranteed sanitization. Let the user redact source text and omit sensitive fields.
6. Keep canonical JSON separate from provider Markdown renderings; validate schema version, data types, field sizes, and total input size. Reject unexpected executable/configuration payloads rather than silently activating them.
7. Store unresolved risks, tests actually performed, verification gaps, artifact references, and next steps. Do not claim a receiving agent has executed, remembered, accepted, or verified a bundle.
8. Explain that pasting/uploading to another provider leaves the local-only boundary by the user's own action and is subject to that provider's data policies.

## Positioning and limitations

Useful differentiation is explicit provenance, reviewable summaries, and a consistent local schema. Markdown instructions, configuration migration, native resume, transcript sharing, and APIs already exist. Avoid claims of invention, lossless memory transfer, universal interoperability, automatic synchronization, or live integration. Absence of an interface in this focused review is not proof that no such interface exists; recheck official documentation before expanding capabilities.

## Maintenance recheck — 2026-10-30

Reopened the official Codex CLI reference, Claude command reference, Cursor rules, Gemini session-management guide and Grok overview linked above. Codex final-output files, Claude conversation export versus configuration import, Cursor activated rules, Gemini native resume/fork, and Grok document upload remain distinct from this utility's neutral wire format. No native bundle integration was implemented or tested. The new local continuation command seals user-reviewed neutral JSON; it does not resume a vendor session or send data to a provider. Existing evidence claims beyond those five surfaces retain their October 29 research date.

## Maintenance recheck — 2026-10-31

Reopened the same five official surfaces listed in the October 30 recheck. They still distinguish provider session/configuration features from this project’s neutral payload. Added a generic manual v2 destination-label envelope, not a sixth verified provider or native interface. Future labels are unverified text only; users must establish destination capability and sharing permission themselves. No accounts or vendor calls were used. Built-in v1 envelopes remain frozen, and payload schema 1.0 is unchanged.
