import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractArticleDocument, extractCgiDataFields, renderMarkdown } from '../src/markdown.mjs';

const html = `<!doctype html><html><body>
  <h1 id="activity-name">测试文章</h1><span id="js_name">示例作者</span>
  <div id="js_content" style="visibility:hidden">
    <p>第一段<strong>重点</strong></p>
    <img data-src="https://mmbiz.qpic.cn/test?wx_fmt=png" alt="图一">
    <script>bad()</script>
  </div>
</body></html>`;

test('extractArticleDocument finds content and lazy-loaded images', () => {
  const parsed = extractArticleDocument(html);
  assert.equal(parsed.title, '测试文章');
  assert.equal(parsed.author, '示例作者');
  assert.equal(parsed.images[0].url, 'https://mmbiz.qpic.cn/test?wx_fmt=png');
  assert.equal(parsed.content.find('script').length, 0);
});

test('extractCgiDataFields parses image-share content without executing remote JavaScript', () => {
  const imageShare = `<script>
    window.cgiDataNew = {
      title: JsDecode('图片\x26quot;标题\x26quot;'),
      content_noencode: JsDecode('正文第一行\x0a第二行'),
      item_show_type: '8' * 1,
      picture_page_info_list: [
        {
          cdn_url: JsDecode('https://mmbiz.qpic.cn/one?wx_fmt=png\x26amp;from=appmsg'),
          watermark_info: { cdn_url: JsDecode('https://mmbiz.qpic.cn/watermark') },
        },
        {
          cdn_url: JsDecode('https://mmbiz.qpic.cn/two?wx_fmt=jpeg'),
        },
      ],
    };
  </script>`;
  const parsed = extractCgiDataFields(imageShare);
  assert.equal(parsed.title, '图片"标题"');
  assert.equal(parsed.content, '正文第一行\n第二行');
  assert.equal(parsed.itemShowType, 8);
  assert.deepEqual(parsed.pictureUrls, [
    'https://mmbiz.qpic.cn/one?wx_fmt=png&from=appmsg',
    'https://mmbiz.qpic.cn/two?wx_fmt=jpeg',
  ]);
});

test('extractCgiDataFields accepts the newer plain-string cgiData format', () => {
  const imageShare = `<script>
    window.cgiDataNew = {
      title: '图片分享',
      content_noencode: '',
      item_show_type: '8' * 1,
      picture_page_info_list: [
        {
          cdn_url: 'https://mmbiz.qpic.cn/plain?wx_fmt=jpeg',
          watermark_info: { cdn_url: 'https://mmbiz.qpic.cn/watermark' },
        },
      ],
    };
  </script>`;
  const parsed = extractCgiDataFields(imageShare);
  assert.equal(parsed.title, '图片分享');
  assert.equal(parsed.itemShowType, 8);
  assert.deepEqual(parsed.pictureUrls, ['https://mmbiz.qpic.cn/plain?wx_fmt=jpeg']);
});

test('extractArticleDocument falls back to cgiData when a share page has an empty js_content', () => {
  const sharedArticle = `<div id="js_content"></div><script>
    window.cgiDataNew = {
      title: '分享文章',
      content_noencode: '<p>被分享文章的完整正文</p><img data-src="https://mmbiz.qpic.cn/shared?wx_fmt=jpeg">',
      item_show_type: '0' * 1,
      picture_page_info_list: [],
    };
  </script>`;
  const parsed = extractArticleDocument(sharedArticle);
  assert.equal(parsed.content.text(), '被分享文章的完整正文');
  assert.equal(parsed.images.length, 1);
});

test('inline data images do not count as failed remote assets', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'wechat-md-inline-test-'));
  const inlineHtml = '<div id="js_content"><p>正文</p><img src="data:image/png;base64,AA=="></div>';
  const result = await renderMarkdown({
    rawHtml: inlineHtml,
    article: { aid: '2_1', title: '内嵌图片', create_time: 1704038400, link: 'https://mp.weixin.qq.com/s/x' },
    account: { nickname: '示例公号', original_id: 'gh_testaccount0000', fakeid: 'fake' },
    articleStem: 'inline',
    outputDir,
  });
  assert.equal(result.imageCount, 0);
  assert.equal(result.imageFailures.length, 0);
});

test('renderMarkdown writes frontmatter and local image links', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'wechat-md-test-'));
  const response = new Response(Buffer.from('image-bytes'), { headers: { 'content-type': 'image/png' } });
  const result = await renderMarkdown({
    rawHtml: html,
    article: {
      aid: '1_1',
      title: '测试文章',
      author_name: '示例作者',
      create_time: 1704038400,
      link: 'https://mp.weixin.qq.com/s/example',
      item_show_type: 0,
    },
    account: { nickname: '示例公号', alias: 'gh_testaccount0000', fakeid: 'fake' },
    articleStem: 'article-one',
    outputDir,
    fetchImpl: async () => response.clone(),
  });
  assert.match(result.markdown, /account_id: "gh_testaccount0000"/);
  assert.match(result.markdown, /第一段\*\*重点\*\*/);
  assert.match(result.markdown, /\.\.\/images\/article-one\/001-[a-f0-9]{10}\.png/);
  const imageName = result.markdown.match(/001-[a-f0-9]{10}\.png/)[0];
  assert.equal(await readFile(path.join(outputDir, 'images', 'article-one', imageName), 'utf8'), 'image-bytes');
});
