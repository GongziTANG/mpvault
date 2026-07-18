import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOriginalIdFromHtml, parsePublishPage } from '../src/wechat-client.mjs';

test('parsePublishPage flattens articles but advances by message count', () => {
  const page = parsePublishPage({
    total_count: 12,
    publish_list: [
      {
        publish_info: JSON.stringify({
          appmsgex: [
            { aid: '1_1', itemidx: 1, title: '头条' },
            { aid: '1_2', itemidx: 2, title: '次条' },
          ],
        }),
      },
      { publish_info: JSON.stringify({ appmsgex: [{ aid: '2_1', itemidx: 1, title: '另一条消息' }] }) },
    ],
  });
  assert.equal(page.articles.length, 3);
  assert.equal(page.messageCount, 2);
  assert.equal(page.rawMessageCount, 2);
  assert.equal(page.totalCount, 12);
});

test('extractOriginalIdFromHtml reads the gh original id', () => {
  assert.equal(extractOriginalIdFromHtml("user_name: JsDecode('gh_testaccount0000'),"), 'gh_testaccount0000');
  assert.equal(extractOriginalIdFromHtml("user_name: 'gh_testaccount0000',"), 'gh_testaccount0000');
  assert.equal(extractOriginalIdFromHtml('var user_name = "gh_testaccount0000";'), 'gh_testaccount0000');
});
