---
name: mpvault-archive
description: Turn all accessible historical articles from a WeChat public account into a resumable, locally imaged, searchable, verified Markdown knowledge vault. Use when Codex is asked to 导出公众号、抓取微信公众号历史文章、把公众号转成 Markdown、建立公众号知识库、搜索已归档文章、续传公众号下载、核验公众号归档完整性, or operate MPVault with a target original ID such as gh_xxx.
---

# Build an MPVault Knowledge Vault

Create a local archive with explicit evidence for exported, deleted, unavailable, and failed records. Treat `manifest.json` and `verification.json` as completion evidence; never infer success merely from a command exiting.

## Preflight

1. Obtain the target original ID (`gh_...`), optional display name, and output directory from the request or existing context.
2. Resolve the MPVault repository root. When bundled in the source repository, it is two directories above this `SKILL.md`; confirm its `package.json` name is `mpvault`. Otherwise locate a checkout or clone `https://github.com/GongziTANG/mpvault.git`.
3. Confirm Node.js 22 or newer with `node --version` and run `npm install` in the repository root.
4. Run every `npm exec mpvault` command with the repository root as working directory. Do not require global npm installation or sudo.
5. Keep `.wechat-session/`, exports, QR codes, cookies, tokens, account identifiers, article content, and absolute local paths out of GitHub issues, commits, and external messages.

## Authenticate

Run:

```bash
npm exec mpvault -- login
```

Keep the process active while it polls. When it prints `QR_READY <absolute-path>`, show that local image to the user in commentary and ask them to scan it. Tell them to select a public account or service account, not a mini program. Wait for `LOGIN_OK`.

Reuse a valid local session. If it expires, run login again without deleting the export directory.

## Lock the target and export

Run:

```bash
npm exec mpvault -- export \
  --account gh_xxx \
  --name "公众号名" \
  --output "/absolute/output/path"
```

Require the original ID to match exactly. Use the display name only to assist search. Keep the default 5-second list delay unless the user requests otherwise. On interruption or `200013` rate limiting, wait and rerun the identical command so the checkpoint resumes.

## Verify independently

Always run after export:

```bash
npm exec mpvault -- verify --output "/absolute/output/path"
```

Require all of the following before reporting completion:

- `listCompleted` is true.
- `failed` and `pending` counts are zero.
- `missingFiles`, `emptyFiles`, `emptyBodyFiles`, and `missingImages` are empty.
- `imageFailures` is zero.
- `ok` is true.

Treat deleted and explicitly unavailable WeChat records as valid terminal states. Report their counts separately; do not describe them as exported articles.

## Search the vault

When the user asks to find archived content, run:

```bash
npm exec mpvault -- search \
  --output "/absolute/output/path" \
  --query "关键词一 关键词二" \
  --limit 20
```

Use `--json` for downstream automation. Explain that multiple terms use AND matching and title matches rank higher.

## Report safely

Report the requested operational result in the conversation, but never publish account identifiers, article content, export counts tied to a private target, credentials, or local absolute paths to a public repository. For a private user report, include list/exported/deleted/unavailable/failed counts, image reference count, verification result, output path, and date range when available.

## Decide on OCR

Keep OCR off unless requested. Recommend selective `auto` OCR for image-share or image-dominant articles, not promotional posters, QR codes, and decorative images. Preserve OCR as derived data and never let OCR failure invalidate the source archive. Read `docs/OCR-STRATEGY.md` before implementing it.

## Recover from edge cases

Read [references/recovery.md](references/recovery.md) when target matching, pagination, special messages, empty Markdown, rate limiting, or verification fails. Preserve checkpoints and unknown failures; do not relabel parser failures as unavailable content.
