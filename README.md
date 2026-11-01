# Cross-Agent Handoff

**Keep your work understandable when you change AI assistants.**

Use this for a marketing plan, operations handover, research project, business decision or code change. It works locally on your computer. You choose what to bring, review it, and decide what to share with your next assistant.

There are two different workflows:

| Your situation | Choose |
|---|---|
| “Continue this task in another assistant.” | **Task handoff:** a short, editable record of the goal, context, preferences, decisions and next steps. Repository and code details are optional. |
| “I am switching my everyday AI tool for the long term.” | **Full-tool migration:** deliberately select your exported history, preserve the original export locally, build a portable library of many conversations, review omissions and redact sensitive fields. Resume large collections in batches. |

Migration preserves the **selected export**, not everything a vendor knows about you. Hidden memory, missing attachments, deleted chats and settings absent from the export cannot be recovered. Our output is a portable library and reference documents: it does not recreate a destination's chat sidebar or silently install memories. Some providers offer their own native import; see [supported formats and provider routes](docs/migration.md#provider-coverage).

## Choose how to use it

- **Desktop app:** a real local app with file pickers and guided task/migration screens. No AI-account login inside the app. Download the unsigned macOS Apple silicon (arm64) build from the [release](https://github.com/Huzaifa-Asif/cross-agent-handoff/releases). It requires Python 3.11+ already installed. Follow macOS security prompts; no notarization or Windows/Linux desktop testing is claimed. [Desktop guide](desktop/README.md).
- **CLI with Python:** download/extract the source ZIP and run the commands below from its folder. Python 3.11+ on macOS or Linux is required. No Python packages or API keys are needed.
- **CLI with Node/npm:** the same Python engine with a small npm launcher. Requires **Node 20+ and Python 3.11+**. npm/npx saves a global installation step; it does not remove these prerequisites. No runtime is downloaded and there are no install hooks.

Install Python from [python.org](https://www.python.org/downloads/) or your trusted package manager. Install Node, if using npm, from [nodejs.org](https://nodejs.org/). Check `python3 --version` and `node --version`.

**npm publication status:** the 1.0.0 scoped package is prepared for first publication, subject to authenticated scope ownership. Until the release confirms a live registry package, use the GitHub release tarball:

```sh
# Download huzaifa-asif-cross-agent-handoff-1.0.0.tgz from the GitHub release first.
npx --offline --ignore-scripts --package ./huzaifa-asif-cross-agent-handoff-1.0.0.tgz handoff --doctor
```

If the correct Python is not on your PATH, set `HANDOFF_PYTHON` to its executable, for example `HANDOFF_PYTHON=/opt/homebrew/bin/python3`. The candidate npm name is `@huzaifa-asif/cross-agent-handoff`; the unscoped name belongs to a different project. Do not install that other package expecting this tool.

## Task handoff: continue one piece of work

```sh
python3 handoff.py new --goal "Prepare the launch plan" --provider claude \
  --domain marketing --context "Budget approval is still pending" \
  --preference "Use plain English" --output task.json
python3 handoff.py inspect task.json
python3 handoff.py export task.json --provider codex --output handoff-codex.md
```

Edit `task.json` to add what is known, what is missing and the next steps. Review `handoff-codex.md`, then explicitly attach or paste it as reference context in the next assistant. No content is sent automatically. Developers can use [the code example](examples/example.json); business users can use [the business example](examples/business-task.json).

With the npm tarball, replace `python3 handoff.py` with the `npx … handoff` command above, keeping the same arguments. The app exposes the same engine with local controls.

## Full-tool migration: switch for the long term

1. Request an export using your provider's official controls. You sign in **on the provider's site**, not inside this tool. Select only exports you are authorized to move.
2. Choose the explicit migration workflow. Your source export remains untouched; the workspace gets a private local snapshot.
3. Process it in batches, review the resulting records and omissions, then export a reviewed portable library.

Try the synthetic example first:

```sh
python3 handoff.py migrate plan examples/migration-history.json \
  --workspace migration-work --provider generic --format generic-json \
  --confirm-long-term-migration
```

The command prints a `checkpoint` digest. Copy its value into the next command:

```sh
python3 handoff.py migrate run --workspace migration-work --base-digest CHECKPOINT
python3 handoff.py migrate review --workspace migration-work
```

One `run` automatically processes bounded batches until finished and streams phase/count progress. Conversation totals stay unknown until established. Press Ctrl+C to pause safely; resume with the **latest** checkpoint printed in the paused result or shown by `review`. Partial/opaque results are reported with omissions rather than a successful 100% coverage claim. Review includes record filenames; inspect selected records before sharing:

```sh
python3 handoff.py migrate show --workspace migration-work --record record-00000-00000.json
python3 handoff.py migrate export --workspace migration-work --base-digest LATEST_CHECKPOINT \
  --target codex --output reviewed-library --confirm-reviewed
python3 handoff.py migrate verify reviewed-library
```

`reviewed-library` contains JSON records, Markdown references and a checksummed manifest. Start with the index/manifest and select relevant documents for the new assistant. A destination's context and upload limits still apply; this tool does not automatically feed an entire lifetime of chats into a model. For a lossless transfer of the selected original export as well, explicitly add `--include-original-source` **only after reviewing it**. That option is refused after normalized-record redaction because the raw snapshot still contains originals.

Read [migration instructions](docs/migration.md) for Claude exports, document/ZIP collections, resumable limits, redaction and retention. Gemini's own supported native importer uses original eligible provider ZIPs; do not upload our generated library as if it were a native import ZIP.

## Technical details for developers

- **Compatibility:** existing schema 1.0 task bundles, five built-in manual exports, custom envelopes and original CLI commands continue to work. New tasks use schema 2.0 with optional repository/code fields. Older versions cannot read schema 2.0 or migration libraries. Task schema, migration checkpoint and portable library versions are separate. [Compatibility policy](docs/migration.md#compatibility).
- **Plugins:** Codex, Claude Code and Cursor packages expose six bounded task MCP tools. They process explicitly supplied text; migration is a separate CLI/desktop filesystem workflow. No host-account history scanning or vendor API connection. [Plugin installation](docs/platform-plugins.md).
- **Security/privacy:** imported messages, tool calls and preferences are untrusted data. The tool never executes imported commands, fetches links/attachments, writes agent instruction files or transmits data to a vendor. Exported context becomes subject to the destination's policies only when you choose to share it. Redaction is explicit, not comprehensive secret detection. [Security](SECURITY.md), [privacy](docs/privacy.md).
- **Formats:** [task schema 1.0](docs/schema-v1.json), [task schema 2.0](docs/schema-v2.json), [API](docs/api.md), [task command reference](docs/task-reference.md), [migration format/limits](docs/migration.md).
- **Platform:** POSIX no-follow filesystem primitives are required. macOS and Linux CLI are supported; Windows is not. The desktop build is unsigned and currently macOS-only. No automatic runtime installation, background monitor, telemetry or cloud service.

Development checks:

```sh
python3 -m unittest discover -s tests -v
python3 -m compileall -q handoff.py handoff_mcp.py migration.py tests
python3 scripts/check_source.py
python3 scripts/build_source.py
python3 scripts/build_plugins.py --output dist/plugins-1.0.0
npm test
npm run check
npm exec --yes --ignore-scripts --package pyright@1.1.414 -- pyright --level error
npm pack --ignore-scripts
```

See [verification checkpoint](CHECKPOINT.md) and release notes for checks actually run, independent review, package publication and remaining gaps. MIT licensed. [Contributing](CONTRIBUTING.md).
