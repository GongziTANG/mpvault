import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { searchArchive } from '../src/library.mjs';

test('searchArchive finds all query terms and ranks title matches first', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'mpvault-search-'));
  await mkdir(path.join(outputDir, 'articles'));
  await writeFile(path.join(outputDir, 'articles', 'one.md'), '# 山水笔记\n\n一段关于春天与远行的记录。\n');
  await writeFile(path.join(outputDir, 'articles', 'two.md'), '# 普通笔记\n\n春天适合远行，远行也让人重新理解春天。\n');
  await writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify({
      articles: [
        {
          status: 'exported',
          title: '春天远行指南',
          publishedAt: '2026-02-01T00:00:00.000Z',
          file: 'articles/one.md',
          sourceUrl: 'https://example.test/one',
        },
        {
          status: 'exported',
          title: '普通笔记',
          publishedAt: '2026-03-01T00:00:00.000Z',
          file: 'articles/two.md',
          sourceUrl: 'https://example.test/two',
        },
        { status: 'deleted', title: '春天远行', file: null },
      ],
    })
  );

  try {
    const result = await searchArchive(outputDir, '春天 远行', { limit: 1 });
    assert.equal(result.totalMatches, 2);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].title, '春天远行指南');
    assert.match(result.results[0].snippet, /春天.*远行/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
