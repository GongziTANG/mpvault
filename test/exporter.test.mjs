import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractLocalImageRefs, hasMeaningfulMarkdownBody, verifyExport } from '../src/exporter.mjs';

test('hasMeaningfulMarkdownBody rejects files containing only frontmatter and title', () => {
  assert.equal(hasMeaningfulMarkdownBody('---\ntitle: "x"\n---\n\n# x\n'), false);
  assert.equal(hasMeaningfulMarkdownBody('---\ntitle: "x"\n---\n\n# x\n\n正文'), true);
});

test('extractLocalImageRefs handles Turndown angle paths with spaces and escaped parentheses', () => {
  const markdown =
    '![](<../images/Day 35 \\(三\\)/001.jpg>)\n![](../images/plain/002.png "图")\n![](../images/day\\(三\\)/003.jpg)';
  assert.deepEqual(extractLocalImageRefs(markdown), [
    '../images/Day 35 (三)/001.jpg',
    '../images/plain/002.png',
    '../images/day(三)/003.jpg',
  ]);
});

test('verifyExport fails when a Markdown local image reference is missing', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'wechat-verify-test-'));
  await mkdir(path.join(outputDir, 'articles'), { recursive: true });
  await writeFile(path.join(outputDir, 'articles', 'one.md'), '![](<../images/not-found/001.jpg>)\n');
  await writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify({
      account: { nickname: '测试号' },
      listCompleted: true,
      articles: [{ key: 'one', status: 'exported', file: 'articles/one.md', imageFailures: [] }],
    })
  );
  const report = await verifyExport(outputDir);
  assert.equal(report.ok, false);
  assert.equal(report.localImageRefs, 1);
  assert.equal(report.missingImages.length, 1);
});
