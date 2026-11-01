# Cross-Agent Handoff desktop

A real Electron desktop app for focused task handoffs and deliberate local migration of selected history exports. It uses the same Python engine as the CLI. There is no AI account sign-in in this app: request an export on your provider's website, then select that downloaded file here.

## Prerequisites

- macOS with an installed Python 3.11+ interpreter at `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, or `/usr/bin/python3`. Install Python yourself from its official source; the app never downloads it. The POSIX safe-file engine does not support Windows in this release.
- For development/builds: Node 22.12+ and npm. `npm ci` installs the pinned official Electron build tools. Run `npm run setup:electron` explicitly to download the official development runtime before `npm start`; the start script refuses to download it automatically. The explicit packaging command also obtains the pinned Electron binary for its build.

```sh
cd desktop
npm ci
npm test
npm run check
npm run setup:electron
npm start
npm run build:mac
```

The macOS build is written outside the source tree, in `../desktop-artifacts` relative to the repository's parent directory. It is **unsigned and not notarized**, not an App Store release. Do not bypass OS security warnings. Python remains an explicit external prerequisite. Other native platforms and signing/notarization are not claimed.

## Workflows

**One task:** write a goal, context and preferences, save a JSON handoff, then save a reviewed reference document for your chosen assistant. Repositories and code are optional.

**Move my library:** select an exported file, choose its documented parser or preserve-only mode, select a new local folder, confirm a deliberate long-term move, start automatic processing of bounded batches until completion, inspect records and omissions, redact explicit fields and save reviewed portable files. Resume an existing library with its checkpoint. Expiry blocks processing/export but does not delete originals. Redaction does not remove the original snapshot. Portable exports exclude original source bytes by default. An explicit unchecked option can include the full selected source archive, with a sensitive-content warning; the engine refuses this option after any redaction.

Files are never sent to an AI service. Reference files do not recreate native history, settings or hidden memory. Gemini has a separate provider-supported history import for certain original archives; the generated portable library is not that format. Consult the root provider/migration documentation for exact coverage and limits.

## Security model

Only packaged local assets load, under a dedicated custom protocol and an ephemeral browser session. CSP blocks connections and inline scripts; renderer Node integration is disabled, sandboxing and context isolation are enabled, permissions are denied, and navigation/new windows are blocked. Untrusted records render as text, never HTML. Native file dialogs create opaque handles; renderer requests cannot supply arbitrary filesystem paths or executable names. IPC sender frames, action names and argument shapes are checked. The Python subprocess uses an argument array with `shell: false`, a limited environment and bounded output. No credentials, telemetry, auto-updater or imported commands are used.

The GUI paginates 100 record summaries at a time, provides local text search with up to 20 previews, and displays up to 256 KiB of a selected record with a visible limit. Use the CLI to inspect a longer record before sharing. Pause (or Esc while processing) requests a graceful checkpoint from the local engine. The app waits up to five seconds before stopping only its own unresponsive child process. Closing the app also waits for this pause/stop sequence. Resume continues automatically from the verified checkpoint; known counts and unknown totals are distinguished, and omitted/error results never show a false 100%. Cancelling an initial snapshot can leave an incomplete folder; choose a fresh destination rather than overwriting it.

Developer tests use synthetic fixtures and no model/API calls. These checks do not prove another provider will obey its own trust boundaries. Packaged UI tests and actual platform evidence are recorded in release evidence rather than assumed from a successful build.
