import test from 'node:test';
import assert from 'node:assert/strict';
import { articleStem, sanitizeFilename } from '../src/common.mjs';

test('sanitizeFilename removes unsafe filesystem characters', () => {
  assert.equal(sanitizeFilename('  标题: A/B?  '), '标题- A-B-');
});

test('articleStem is stable and includes date, title and aid', () => {
  const stem = articleStem({ create_time: 1704038400, title: '禅修 / 入门', aid: '123_1' });
  assert.equal(stem, '2024-01-01-禅修 - 入门-123_1');
});
