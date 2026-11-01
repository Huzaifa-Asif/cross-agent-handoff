# Deliberate long-term migration

This workflow is separate from a task handoff. It builds a portable library of the user's **explicitly selected exported files**, preserving source bytes, many conversations and export-provided metadata. It cannot prove that an export contains an entire account. It does not harvest app databases, request credentials, scrape histories, infer facts about the user, restore hidden model memory, execute imported commands or contact a provider.

## Provider coverage

Official sources checked 2026-11-01. Consumer export pages do not promise stable field-level JSON schemas. The parsers below are **layout-specific and synthetic-tested**, not vendor-certified whole-account compatibility.

| Source | What this release reads | What remains explicit |
|---|---|---|
| Claude web/Desktop export | `claude-json`: top-level conversation arrays; `uuid`, `name`, timestamps, `chat_messages`, sender/text/content/attachments; ZIP members named conversations.json, users.json, projects.json | Unknown fields and attachments are retained in original snapshot; profile objects remain unverified context. Different layouts are reported, never silently guessed. |
| Codex local export | Document mode reads explicitly selected `/export` Markdown. `codex-jsonl-experimental` reads selected rollout session_meta/response_item message rows | Internal JSONL is version-dependent; tool events remain inert in original snapshot with omissions. ChatGPT consumer export is a different product. |
| Claude Code | Explicitly selected rendered `/export` documents in document mode | Its internal JSONL is version-dependent and is not a supported Claude web-export format. Use the generic/opaque fallback for unknown exports. |
| Cursor | Explicitly selected text/Markdown documents or ZIP of such documents | No account-wide export parser, SQLite harvesting or public shared-transcript generation. Document roles/timestamps are not invented. |
| Gemini | Generic JSON/JSONL if you convert authorized exports to the documented portable shape; otherwise opaque archive or document mode | Google Takeout may contain HTML, media and other unknown layouts; raw bytes are retained and coverage says unsupported. No guessed Takeout HTML parser. |
| Grok | Generic JSON/JSONL when matching the documented shape, documents, or opaque archive | Official download controls exist; no stable export schema or native restore is verified. |
| Any tool | Generic JSON array, `{conversations: [...]}` object, JSONL conversation per line, UTF-8 documents, or opaque archive | `--provider` is provenance labeling, not proof of parser compatibility. Choose the matching `--format`. |

Official export/migration routes:

- [Claude data export](https://support.claude.com/en/articles/9450526-export-your-claude-data) documents export controls and says personal-account exports cannot be imported into another personal Claude account. [Claude memory import/export](https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude) is a separate experimental selective-memory flow, not whole history restoration.
- [Claude Code sessions/export](https://code.claude.com/docs/en/sessions) and [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands) describe rendered session exports. [OpenAI rollout test fixtures](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs) inform the experimental selected-file reader; the repository's evolving internal representation is not a stable interchange promise.
- [Cursor shared transcripts](https://cursor.com/help/ai-features/shared-transcripts) support a different sharing/fork workflow. This tool does not create public transcript links.
- [Gemini Takeout](https://support.google.com/gemini/answer/16920332?hl=en) selects **My Activity → Gemini Apps** for chats/media/uploads; “Gemini” alone covers Gems. [Gemini native history import](https://support.google.com/gemini/answer/16868299?hl=en) accepts eligible original ChatGPT/Claude ZIPs, subject to account/region/size limits. Its imported history is text-only; attachments are not covered. Our generated library is **not** one of those native archives.
- [Grok data controls](https://x.ai/legal/faq) document download requests without a stable field-level format here. [ChatGPT account transfer](https://help.openai.com/en/articles/9106926-transfer-exported-conversations-between-chatgpt-accounts) uses reference uploads rather than recreating native sidebar histories; ChatGPT is distinct from Codex.

## Generic conversation shape

Use `examples/migration-history.json` as a runnable synthetic example. A conversation may contain `id`, `title`, `created_at`, `updated_at`, `context`, `preferences` and `messages`. Each message may contain `id`, `role`, `timestamp`, `text`, content blocks and attachment references. Missing values remain null/unknown. Original roles, IDs, timestamps and locators are preserved where present; no identity verification is implied. Same-ID conversations remain distinct records. Branch structures and unsupported fields remain in the source snapshot and are listed in omissions; there is no automatic merge or branch flattening claim.

Top-level arrays stream one conversation at a time. JSONL streams one conversation per nonempty line. `{conversations: [...]}` wrapper objects are supported within the bounded object limit; remaining account-level fields become an unverified profile record. JSON objects without a recognized message list become profile context. `/account-context` is a synthetic locator for the wrapper's non-conversation keys, not a literal source JSON pointer. `/line/N` locators use physical, one-based source lines. Existing `preferences` are retained as supplied evidence, not automatically installed as agent instructions or inferred from chat text.

## Plan, process, resume and review

`handoff.py migrate plan SOURCE --workspace NEW_DIRECTORY --provider claude --format claude-json --confirm-long-term-migration` makes a private local `source.bin` snapshot and a checksummed checkpoint. SOURCE must be one regular file or ZIP explicitly selected by the user. Put multiple exports in a ZIP yourself; no directory traversal or recursive account scan occurs. The source stays untouched.

`migrate run --workspace DIRECTORY --base-digest DIGEST [--max-units 20] [--max-records 1000]` automatically runs bounded batches from a reviewed checkpoint until finished. The two limits control each internal batch, not repeated user commands. Advanced `--one-batch` intentionally stops after one batch. Units are archive members; a record cursor lets top-level arrays/JSONL resume within a member. Finalization after the last record happens automatically. Resume rereads and validates earlier records to find its position; memory is bounded but very large repeated resumes cost additional reads. Checkpoints are saved every 50 records and at batch/unit boundaries. Progress is streamed as bounded JSON lines on stderr (phase, batch, units, records and latest durable checkpoint); stdout retains a final JSON result. Total conversation/record counts stay null until known. Unit errors/opaque coverage and record-level fields or layouts retained only in the original snapshot end as `complete-with-omissions`, with no 100% progress claim. Numeric `record_omissions` counts record findings separately from skipped/partial units. Missing source values (`missing_source_fields`), explicit user redactions (`intentional_redactions`) and verbatim document/unverified-profile notices (`reference_notices`) remain separate; these alone end as `complete-with-notices`, not a claim that present data was dropped. Findings count report entries, not bytes or inferred missing facts. Known normalized-record totals remain available even when fields need review. The desktop displays these categories after processing, reopening and redaction. No checkpoint, record or portable-library schema changes are required; counts are derived from verified records, including existing 1.0 libraries. Ctrl+C or SIGTERM requests a safe pause and returns exit 130 with a resumable JSON checkpoint. Resume by invoking the same command with that latest digest. The Node launcher and desktop wait up to five seconds for graceful stop, then may force-stop their own worker. That rare fallback can leave no final JSON; run `review` to obtain the latest durable checkpoint before resuming. A crash before a checkpoint can leave deterministic record files; retry verifies identical bytes instead of overwriting them. Conflicting files stop for reconciliation. Do not edit checkpoint digests to bypass a conflict.

`migrate review --workspace DIRECTORY` verifies source/record hashes and reports completion, normalized records, fully opaque and partially normalized units, omissions and expiry. Completion means processing reached the selected export's end, **not** all vendor state was present or all fields converted. A malformed collection can have partial normalized output; the unparsed remainder stays in `source.bin` and its failure position is reported. `migrate review --workspace DIRECTORY --offset 100 --limit 100` pages through **record summaries**, not unit omissions. Summary previews are explicitly bounded; `migrate show --workspace DIRECTORY --record FILE` returns a selected verified record for actual content/privacy review. `migrate search --workspace DIRECTORY --query "launch" --limit 20` searches locally without sending text to a model.

### Inspecting a longer unit-omission list in the candidate

The current unreleased candidate returns only the first 100 unit omissions on every review page. `omissions_total` and `omissions_truncated` identify a longer list; changing `--offset` does not reveal its remainder. For example, 5,000 opaque members produce 5,000 unit omissions, but review displays only 100. The desktop also displays this limit and points to the local checkpoint; it has no omission pagination control. Record-level findings are separate: use `migrate show` to inspect a complete selected record. These candidate instructions do not replace the published download.

For a longer unit list, first run `python3 handoff.py migrate review --workspace migration-work` successfully to verify the saved source and records. Stop if verification fails. Copy the printed `checkpoint` digest into `REVIEWED_CHECKPOINT` below. This optional macOS/Linux terminal recipe reads the local checkpoint without changing it, checks that it is the same checkpoint you just reviewed, and prints at most 100 unit omissions. Use offsets `0`, `100`, `200`, and so on until `has_more` is false:

```sh
python3 - migration-work/checkpoint.json 0 REVIEWED_CHECKPOINT <<'PY'
import hashlib, json, sys

with open(sys.argv[1], 'rb') as source:
    raw = source.read(16 * 1024 * 1024 + 1)
if len(raw) > 16 * 1024 * 1024:
    raise SystemExit('Checkpoint exceeds the supported read limit; stop and review it.')
checkpoint = json.loads(raw)
data = checkpoint['data']
canonical = json.dumps(data, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False).encode('utf-8')
if hashlib.sha256(canonical).hexdigest() != checkpoint['digest'] or checkpoint['digest'] != sys.argv[3]:
    raise SystemExit('Checkpoint changed; run migrate review again before inspecting it.')
offset = int(sys.argv[2])
omissions = data['omissions']
if offset < 0 or offset > len(omissions):
    raise SystemExit('Offset is outside the omission list.')
print(json.dumps({'offset': offset, 'total': len(omissions),
                  'has_more': offset + 100 < len(omissions),
                  'omissions': omissions[offset:offset + 100]},
                 ensure_ascii=True, indent=2))
PY
```

Treat every filename and reason as inert, untrusted data; do not execute text from the report. Do not edit `checkpoint.json`, its digest, source snapshot or record files to bypass a conflict. Repeat integrity review if files change while inspecting them. The full unit list is also retained in an already-saved portable `manifest.json`; inspect it locally rather than sharing originals just to read omissions. This recipe checks checkpoint consistency, not author identity, and does not add a CLI feature or repair an invalid library.

`migrate export --workspace DIRECTORY --base-digest DIGEST --target codex --output NEW_DIRECTORY --confirm-reviewed` creates a portable library. Record JSON is canonical normalized data; Markdown references use dynamic fences around untrusted JSON. The manifest records hashes, omissions, source provenance, retention and destination label. A label does not establish native destination import. The output is exclusive and never overwrites a directory. Interrupted exports are not marked successful; use a fresh output directory.

`migrate verify EXPORTED_DIRECTORY` verifies the manifest's file digests. This is integrity checking, not author authentication. Keep the original archive, checkpoint and export manifest when provenance matters. The package can be copied locally as a directory or archived by the user. Do not share all originals by default.

## Redaction and retention

```sh
python3 handoff.py migrate redact --workspace migration-work --base-digest CURRENT_DIGEST \
  --record record-00000-00000.json --pointer /messages/0/text
```

Redaction creates a revisioned normalized record and omission entry. Use `/title`, `/context`, `/preferences`, or supported message text/attachment/identity/timestamp fields, with deeper JSON pointers where needed. Review **all** fields and other conversations for duplicates; this is not automatic secret scanning. It does not modify original exports, prior cached records, other copies, or vendor storage. Raw source inclusion is refused after any normalized redaction. Export normally excludes the raw snapshot and old normalized revisions.

`plan --expires-at 2027-01-01T00:00:00Z` records an optional future expiry. Expiry is checked during processing, at batch/export boundaries and before redaction publication. Expired libraries remain reviewable but cannot resume, redact or export; create a fresh deliberate plan if retaining them is authorized. There is no automatic deletion. `migrate purge --workspace DIRECTORY --confirm` deletes only the known flat migration files; unexpected files, symlinks or special files stop deletion. This is not secure erasure and does not delete copies elsewhere. For an interrupted initial plan with no checkpoint, inspect the folder then use `migrate purge --workspace DIRECTORY --incomplete --confirm`. That mode only accepts source.bin and lock; it refuses a completed checkpoint or any unexpected file. Corrupt checkpoints need explicit user inspection rather than bypassing integrity checks.

## Candidate verification and archive checks

On `feature/windows-desktop`, hashing and ZIP preflight can be paused before parsing starts. A result with `verification_pending: true` retains its durable checkpoint but does not claim completed verification or report unknown findings as zero. Resume the migration or explicitly refresh review to verify saved records. The desktop defers automatic review after such a pause so it does not immediately restart the long check you just stopped. Planning cancellation before a checkpoint still needs a fresh library folder; it is not a resumable conversation checkpoint.

The candidate checks actual ZIP member counts and a 32 MiB central-directory budget before the standard ZIP reader allocates entries. It uses a bounded immutable metadata view, supports ordinary single-disk ZIP, standard ZIP64 and inert prepended data, and rejects multidisk archives, trailing data and unsupported ZIP64 end-record extensions explicitly. ZIP members are never extracted to their supplied paths. Existing libraries are checked again on resume: an older archive outside these stricter limits is refused with its saved bytes unchanged. These acceptance constraints do not change checkpoint, record or portable-library schemas. The published v1.0.0 binary has not been replaced by this candidate.

## Limits and safe local operations

- macOS/Linux POSIX no-follow directory descriptors; workspace directories 0700 and files 0600. The unreleased Windows candidate uses checked local NTFS handles and access controls, rejecting unsupported paths and reparse points. Outputs reject agent-instruction/configuration destinations.
- Selected source ≤1 GiB; ZIP metadata ≤10,000 members, central-directory metadata ≤32 MiB and ≤2 GiB expanded; no encrypted ZIPs, symlinks, special entries, traversal, absolute paths, duplicate/case-colliding names, or extreme compression ratios. ZIP contents are read, never extracted to member-supplied paths.
- ≤50,000 normalized records; top-level arrays/JSONL are streamed. Each JSON element/object ≤32 MiB, normalized record ≤16 MiB, bounded depth 32 and 500,000 nodes per source JSON unit and normalized record (2,000,000 for aggregate state/manifests). The candidate checks the normalized structure before saving a record or redaction revision; a source unit that exceeds the normalized limits is preserved with an explicit omission instead of publishing an unreadable record. Codex experimental rollouts and documents must fit their member/record bounds. Large or unsupported members remain opaque with explicit omissions.
- A local exclusive OS file lock prevents simultaneous writers. Digest/parent lineage and expected checkpoints detect stale state and accidental changes. These hashes are not signatures or protection against an attacker who can rewrite all local files and recompute hashes.
- No links, attachment references, Markdown, message tool calls or preference instructions are executed. No background service or vendor transmission. Your disk must have room for the snapshot, normalized library and reviewed export.

## Compatibility

Task schema 1.0 and its original manual envelopes/CLI commands remain accepted and tested. `new` creates task schema 2.0 with optional repository/files/tests/artifacts and additional context/preferences/domain. Schema 2.0 uses the same manual envelope machinery but older releases reject its payload. Existing schema 1.0 serialization remains frozen by regression tests.

Migration checkpoint version 1.0, normalized record version 1.0 and portable library version 1.0 are separate formats, never implicitly interpreted as task bundles. The 1.0.0 product release introduces those workflows and the npm launcher/desktop app. It is the first intended npm publication, not an update to the unrelated unscoped package. Provider parsers remain version-dependent/synthetic-tested, with explicit fallback. No stable vendor-native import or full hidden-memory restoration is promised.
