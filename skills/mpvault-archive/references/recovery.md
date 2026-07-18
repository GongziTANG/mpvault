# Recovery and verification reference

## Target matching

- Search results can omit or repurpose the visible alias. Verify the target by reading a candidate article's `user_name` and matching the requested `gh_...` original ID.
- Support both literal `user_name: "gh_..."` and `user_name: JsDecode('...')` forms.
- A matching nickname is a candidate, never proof.

## Pagination

- `total_count` and `begin` refer to publish messages, not the final number of articles.
- One message can contain several `appmsgex` articles.
- Advance `begin` by the number of entries whose `itemidx` is 1, falling back to the number of publish messages. Add every child article to the state using a stable `aid` key.
- Save `.state/sync.json` after every page. Keep the default delay at 5 seconds.

## Page formats

- A present but empty `#js_content` is not valid content. Require text or a meaningful media element.
- If empty, inspect `window.cgiDataNew.content_noencode`.
- For `item_show_type = 8`, extract `picture_page_info_list[].cdn_url` and build image content.
- WeChat may encode values as literals or `JsDecode(...)`; handle both.

## Status classification

- Use `deleted` or `unavailable` only when the page explicitly says deleted, violation, or temporarily unavailable.
- Missing DOM, changed scripts, empty conversion, HTTP errors, and unknown cases are `failed` and must remain retryable.
- Retry transient article fetch failures with bounded exponential backoff. Do not retry explicit terminal states.

## Completeness proof

The verifier must check more than file counts:

1. List sync reached its terminal empty page.
2. No entry remains failed or pending.
3. Every exported manifest entry has a Markdown file.
4. Every Markdown file contains content after frontmatter and title removal.
5. Every `../images/...` reference resolves to a local file.
6. No image download failure remains in the manifest.

For a manual audit, also search exported Markdown for unexpected remote `mmbiz.qpic.cn` image URLs and compare unique filenames with exported manifest entries.

## Credentials

- Store session JSON with mode `0600`.
- Never log cookies or tokens.
- Never stage `.wechat-session/`, export directories, QR images, or real article fixtures in Git.
- On suspected exposure, stop the run, invalidate the WeChat session, remove the leaked artifact from version history, and authenticate again.
