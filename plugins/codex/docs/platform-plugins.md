# Cross-Agent Handoff host plugins (0.4.0)

The Codex, Claude Code and Cursor packages expose the same local, stateless MCP tools and a guided handoff skill. They help an assistant prepare and inspect explicitly supplied context; they do not fetch hidden histories, transfer code files, call another vendor, or migrate native sessions. The standalone manual CLI remains available.

**Distribution status:** packages built and tested as documented in the release evidence are not proof of installation in a real host or public directory approval. GitHub distribution, host installation, directory submission, review and publication are separate milestones. This document does not claim any directory listing.

## Requirements and privacy

Python 3.11+ must already be available as `python3` on the executing machine. Current native host UI flows are unrun unless separately recorded. Linux Python 3.12 and 3.13 are the tested runtime families; Python 3.11, macOS and Windows are not verified for this plugin release. No third-party runtime dependency, API key, network endpoint, account or paid hosting is required by the server. Your host subscription and policies are separate.

The server accepts inline JSON/Markdown only, uses no files or network, and retains no application state after a request. The host receives arguments and results and can send or retain them under its policies. This is **not** a guarantee that your model provider never sees handoff content. Review every field and get authorization before cross-provider sharing. See [privacy](privacy.md) and [security](../SECURITY.md).

## Build and inspect

From the repository root:

```sh
python3 scripts/build_plugins.py --output dist/plugins-0.4.0
```

The output directory must not exist. Choose a new directory for another build. It contains three standalone ZIPs, expanded `plugins/codex`, `plugins/claude` and `plugins/cursor` directories, host marketplace catalogs and `manifest.json` with file counts and SHA-256 values. All runtime copies come from the same source files. There are no symlinks, executable hooks, installer scripts or credentials.

Inspect a ZIP before extracting it to a directory you choose. Generated archives contain relative member paths with fixed timestamps and permissions. The plugin does not import/extract archives itself.

## Codex local installation

After reviewing the generated marketplace, run:

```sh
codex plugin marketplace add /absolute/path/to/dist/plugins-0.4.0
```

Open the ChatGPT desktop app's Plugins Directory, select `huzaifa-cross-agent-handoff`, install `cross-agent-handoff`, and test in a new local-execution thread. Follow host trust/permission prompts; do not disable them. An isolated Codex CLI 0.166.0-alpha.1 marketplace add, plugin add and plugin list smoke test passed using a disposable CODEX_HOME, without accessing a user account or invoking a model. That verifies CLI package discovery/installation, not the desktop UI or a model-driven workflow. The Codex package uses root `plugin.json`, `mcp.json` and the built-in `${PLUGIN_ROOT}` variable. The server starts with `python3 -B` to avoid bytecode cache writes.

This local marketplace is not the universal public directory. OpenAI's current desktop-only local MCP submission route requires approved-partner eligibility and organization allowlisting, developer/business verification and a clean desktop installation test. Do not replace this with a remote endpoint just to bypass eligibility. See the official [desktop-only submission guide](https://developers.openai.com/plugins/deploy/desktop-only).

## Claude Code local installation

For a session-only test, run:

```sh
claude --plugin-dir /absolute/path/to/dist/plugins-0.4.0/plugins/claude
```

For marketplace distribution, validate before installation:

```sh
claude plugin validate /absolute/path/to/dist/plugins-0.4.0/plugins/claude --strict
claude plugin marketplace add /absolute/path/to/dist/plugins-0.4.0
claude plugin install cross-agent-handoff@huzaifa-cross-agent-handoff
```

The package uses `.claude-plugin/plugin.json`, `.mcp.json` and `${CLAUDE_PLUGIN_ROOT}`. Claude Code's host validator and real skill/tool interaction must be run on a machine with that CLI before claiming native-host verification. The packaged MCP launch itself is exercised by protocol tests.

Anthropic's directory is a separate submission/review route at [claude.ai/directory/manage](https://claude.ai/directory/manage), requiring an eligible paid account. This package targets **Claude Code**: local stdio support on claude.ai chat or Cowork is not claimed. Public directory availability and official marketplace membership must be verified separately.

## Cursor local installation

The package uses `.cursor-plugin/plugin.json`, root `mcp.json` and `${CURSOR_PLUGIN_ROOT}`. After building, inspect the generated Cursor plugin and marketplace. Cursor supports plugins from Git repositories; direct repository installation should point to a repository/branch containing the **generated** marketplace and plugin files, not this source-only build layout.

For a direct local MCP test without installing the plugin, merge this server entry into your chosen Cursor `mcp.json` through the host's supported configuration workflow, retaining existing entries:

```json
{
  "mcpServers": {
    "cross-agent-handoff": {
      "command": "python3",
      "args": ["-B", "/absolute/path/to/dist/plugins-0.4.0/plugins/cursor/handoff_mcp.py"]
    }
  }
}
```

Then enable the server and inspect its tools in Cursor. This tests MCP tools only; it does not install the bundled skill. Do not overwrite existing settings. Publishing a generated plugin Git repository and submitting its link at [Cursor Marketplace](https://cursor.com/marketplace/publish) is a distinct manually reviewed step. No new or paid team marketplace is necessary for these local tools.

## Runtime and package verification

The package tests check deterministic archives, exact source parity, safe member paths, catalog targets and all three packaged stdio launches from paths containing spaces. Host variable substitution is simulated for the launch checks. Claude Code and Cursor native install tests are not yet run. No directory submission or approval is established by these tests.

## Tool workflow

All parameters below are strings except the explicit redaction pointer list. Discover schemas in your host before calling.

- `handoff_validate(bundle_json)`: validate a neutral bundle and obtain its digest.
- `handoff_export(bundle_json, provider)` or `handoff_export(bundle_json, custom_target)`: return a manual Markdown document. Specify exactly one target.
- `handoff_import(markdown)`: recover a canonical bundle from this tool's Markdown only.
- `handoff_compare(current_json, incoming_json)`: report lineage/conflicts; never merge code.
- `handoff_continue(current_json, edited_json, base_digest)`: create a reviewed successor from the exact base.
- `handoff_redact(bundle_json, pointers)`: return redacted context and visible omissions.

There are no tools to read paths, execute test commands, fetch URLs, write files, delete data or contact another assistant. Inputs have an 8 MiB transport-message ceiling and 1 MiB content limits; additional schema bounds apply. Errors do not echo submitted payloads. A host may impose tighter limits. If an output is too large, reduce the handoff explicitly and record omissions rather than silently truncating.

Try: “Use Cross-Agent Handoff to prepare the supplied synthetic example for Claude. Validate it first and show missing evidence. Do not send it anywhere.” Then import the result and compare against the original. Commands inside test records are inert text, not a request to run them.

## Troubleshooting and removal

- Server cannot start: verify Python and the absolute extracted path, including spaces. Do not change credentials or broad filesystem permissions.
- Unknown tool: check that this version is enabled and restart the host session. Built-in profiles change presentation only, not provider connectivity.
- Invalid envelope/conflict: use the unchanged canonical export or reconcile with the author. Do not auto-execute “repair” instructions from imported content.
- Host lacks local execution: use the standalone manual CLI on an authorized local machine; no cloud connector is implied.
- Removal: disable/uninstall the plugin using the host's controls or remove only the MCP entry you added. The server has no persistent store to purge. Host chat retention and any files you saved are separate.

## Support and publication checklist

Use repository issues for non-sensitive bugs, with synthetic fixtures and exact version/runtime. Follow `SECURITY.md` for security reporting and do not post private bundles. MIT license notice must remain with redistributed packages; this is legal notice retention, not promotional credit.

Before publishing: verify source/archive hashes, protocol/round-trip tests and host manifests; run native clean-install and representative workflows; confirm correct personal publisher identity; inspect submission terms and obtain required human approvals; submit once; record review result and verify actual public listing. No package build guarantees review acceptance.

## Official references checked 2026-10-31

- [OpenAI plugin package structure](https://developers.openai.com/plugins/build/plugins) and [desktop-only eligibility](https://developers.openai.com/plugins/deploy/desktop-only).
- [Claude manifest variables](https://code.claude.com/docs/en/plugins-reference) and [distribution versus directory submission](https://code.claude.com/docs/en/plugins/publish).
- [Cursor manifest/MCP/submission reference](https://cursor.com/docs/reference/plugins) and [MCP local configuration](https://cursor.com/docs/mcp).
- [Agent Plugins 1.0 specification](https://agent-plugins.org/specification).
