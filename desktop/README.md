# Cross-Agent Handoff desktop

A real Electron desktop app for focused task handoffs and deliberate local migration of selected history exports. It uses the same Python engine as the CLI. There is no AI account sign-in in this app: request an export on your provider's website, then select that downloaded file here.

## Get started on Mac

1. Download the macOS ZIP from the project's [GitHub releases](https://github.com/Huzaifa-Asif/cross-agent-handoff/releases), extract it, and open **Cross-Agent Handoff.app**. Use the build matching your Mac's processor; the published build is for Apple silicon.
2. Python 3.11 or newer must already be installed. The app checks `/opt/homebrew/bin/python3`, `/usr/local/bin/python3` and `/usr/bin/python3`. If none is suitable, install Python from [python.org](https://www.python.org/downloads/macos/), then reopen the app. Node and npm are unnecessary for the packaged app.
3. In the new candidate, choose **Task Hand Off** to move one task, or **Full Migration** for a deliberate long-term move of your selected exported history. The currently published v1.0 app uses the older labels **One task** and **Move my library**, respectively; the new labels are not yet published.

The Mac app is **unsigned and not notarized**. Do not bypass OS security warnings. The app does not download Python or sign into your AI accounts. Windows is currently an **unreleased candidate**; its requirements and testing limits are below.

## Choose your mode

**Task Hand Off:** describe your goal, context and preferences. Save a handoff, then save a reference document for your next assistant. Review it and explicitly attach or paste it into that assistant. No repository or code is required.

**Full Migration:** first download an official export from your current provider. Select that file in the app, choose its parser (or preserve-only mode), choose a new local library folder, and confirm the long-term move. Start processing once: the app runs bounded batches automatically. Review findings, redact selected fields, and save reviewed portable files. You can pause and resume an existing library.

### Review screens in the unreleased candidate

On [`feature/windows-desktop`](https://github.com/Huzaifa-Asif/cross-agent-handoff/tree/feature/windows-desktop), saving or opening a Task Hand Off shows a read-only snapshot of the saved file. Review the goal, context and preferences; expand **Review all saved fields, including code and provenance** for the complete paged data. Confirm review, then save a reference document. If the file changed, reopen and review it again. **Create or open another** returns to the separate creation form. Its unsaved draft is never used to export an opened file.

The same candidate offers a guided Full Migration redaction picker. Choose a field, inspect the selection, then apply; selecting alone does not change data. Original exports, earlier revisions and previously saved portable copies remain unchanged. Review and save a new portable copy after redaction. This is not secure deletion or automatic secret scanning. Task Hand Off expiry stays informational; the candidate enforces configured Full Migration expiry before redaction as well as processing/export.

These candidate screens and fixes have not replaced the published v1.0.0 download.

Your files stay local. Full Migration preserves the selected export and available parsed context; it cannot establish that the provider supplied your entire account state. Reference files do not recreate native history, settings or hidden memory. Gemini separately supports importing certain original provider archives; this generated portable library is not that format.

Full Migration expiry blocks further processing/export but does not delete originals. Redaction creates a redacted copy while retaining the original local snapshot. Portable output excludes original source bytes by default; an explicit option includes them only before any redaction. Review sensitive content before sharing anything.

## Develop or build

Building requires Node 22.12+, npm and Python 3.11+. The commands below start the Mac development app from this repository. Windows build tooling lives on [`feature/windows-desktop`](https://github.com/Huzaifa-Asif/cross-agent-handoff/tree/feature/windows-desktop), which must be checked out separately; it has not been merged into main.

```sh
cd desktop
npm ci --ignore-scripts
npm run check
npm test
npm run setup:electron
npm start
```

`setup:electron` explicitly downloads the pinned official development runtime; `npm start` never downloads it. To package the Mac app, run `npm run build:mac` on macOS. To build Windows, use `npm run build:windows` only after checking out the Windows candidate branch. Packaging explicitly obtains the pinned official Electron binary. Set `HANDOFF_DESKTOP_OUTPUT` to a new output directory to preserve earlier artifacts; the default is the task's sibling `desktop-artifacts` directory outside the source tree.

## Security model

Only packaged local assets load, under a dedicated custom protocol and an ephemeral browser session. CSP blocks connections and inline scripts; renderer Node integration is disabled, sandboxing and context isolation are enabled, permissions are denied, and navigation/new windows are blocked. Untrusted records render as text, never HTML. Native file dialogs create opaque handles; renderer requests cannot supply arbitrary filesystem paths or executable names. IPC sender frames, action names and argument shapes are checked. The Python subprocess uses an argument array with `shell: false`, a limited environment and bounded output. No credentials, telemetry, auto-updater or imported commands are used.

The GUI paginates 100 record summaries at a time, provides local text search with up to 20 previews, and displays up to 256 KiB of a selected record with a visible limit. Use the CLI to inspect a longer record before sharing. Pause (or Esc while processing) requests a graceful checkpoint from the local engine. The app waits up to five seconds before stopping only its own unresponsive child process. Closing the app also waits for this pause/stop sequence. Resume continues automatically from the verified checkpoint; known counts and unknown totals are distinguished, and omitted/error results never show a false 100%. Cancelling an initial snapshot can leave an incomplete folder; choose a fresh destination rather than overwriting it.

Developer tests use synthetic fixtures and no model/API calls. These checks do not prove another provider will obey its own trust boundaries. Packaged UI tests and actual platform evidence are recorded in release evidence rather than assumed from a successful build.


## Windows portable candidate

The same app and shared engine can be packaged for Windows x64 using Node 22.12+ and an explicitly installed Python 3.11+. Start from a Git clone (requires Git), select the candidate branch, then build:

```sh
# From the root of your Git clone:
git fetch origin
git switch feature/windows-desktop
cd desktop
npm ci --ignore-scripts
npm run check
npm test
npm run build:windows
```

`build:windows` explicitly selects `win32` / `x64`, including on a Mac build host. Set `HANDOFF_DESKTOP_OUTPUT` to a new directory to preserve existing artifacts. Extract the full generated `cross-agent-handoff-<version>-windows-x64-unsigned.zip`, then open `Cross-Agent Handoff.exe`; retain resources, DLLs and license notices beside it. This is an **unreleased, unsigned portable candidate**, not an installer or a natively verified Windows release. Do not bypass OS security warnings.

On Windows, install 64-bit Python 3.11+ yourself from [python.org](https://www.python.org/downloads/). Discovery checks `py -3.11`, `py -3`, then real `python`/`python3` executables on PATH. It requires the shared engine capability probe, pins the discovered interpreter, skips Store `python` aliases and disables Python manager automatic installation. No runtime is silently downloaded. The Windows backend targets Windows 10 1809 or newer and requires a supported local fixed NTFS volume; network/removable paths and reparse points fail closed.

Windows Pause sends only the constant `pause` line over the engine child's private stdin, enabled by `HANDOFF_CANCEL_STDIN=1`. The engine saves a checkpoint and returns exit130. Windows SIGTERM is not used for graceful pause. After five seconds an unresponsive own child may be stopped; reopen the library to verify its latest durable checkpoint. No cancellation file or provider connection is created. Mac signal behavior is unchanged.

The pinned Electron Packager uses JavaScript `resedit` for metadata: no Wine, installer toolchain, signing credential or new account is needed. Both builds retain Electron/Chromium notices. Windows engine resources are at `resources/app`; Mac resources are at `.app/Contents/Resources/app`.

Before claiming native Windows support, run the suite on Windows and inspect the actual packaged executable: task save/open/export; selected-file migration; progress; early pause; relaunch/resume; redaction; existing output rejection; malformed imports; and rejection of unsupported network/removable/reparse locations. Mac cross-builds and simulated Windows control tests do not establish native behavior.

References: [Electron Packager targets](https://electron.github.io/packager/main/), [packager options](https://electron.github.io/packager/main/interfaces/Options.html), [Python Windows launcher/manager](https://docs.python.org/3/using/windows.html).

Candidate validation: [Windows CI on commit 4a7ca1f](https://github.com/Huzaifa-Asif/cross-agent-handoff/actions/runs/41356834855) passed native Python 3.11/3.13 file-safety, task, migration, redaction, pause/resume and retry tests, plus packaged saved-task review for both schemas, changed-file export rejection/reopening, and a 1,250-conversation / 2,500-file migration journey with redaction and a verified new portable copy on Windows Server 2025. The same packaged check also covers a malformed zero-record source, metadata-only wording, picker cancellation, failed-new-copy recovery and rejection of a changed saved-copy checkpoint. File selection in that GUI check uses documented synthetic dialog stubs. This does not establish consumer Windows 10/11 coverage, real OS file-picker interaction, signing, SmartScreen or installation behavior. No Windows release has been published.
