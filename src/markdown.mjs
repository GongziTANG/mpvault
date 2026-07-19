import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { decodeWechatJsString, ensureDir, mapLimit, sha1, USER_AGENT } from './common.mjs';

function yamlString(value) {
  return JSON.stringify(value == null ? '' : String(value));
}

function normalizeUrl(value) {
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  return value.replaceAll('&amp;', '&');
}

function extensionFrom(contentType, url) {
  const normalized = String(contentType || '').split(';', 1)[0].toLowerCase();
  const byType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/avif': '.avif',
  };
  if (byType[normalized]) return byType[normalized];
  const wxFormat = new URL(url).searchParams.get('wx_fmt');
  if (wxFormat) return wxFormat === 'jpeg' ? '.jpg' : `.${wxFormat.replace(/[^a-z0-9]/gi, '')}`;
  const pathnameExt = path.extname(new URL(url).pathname).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(pathnameExt) ? pathnameExt : '.jpg';
}

export function extractArticleDocument(rawHtml) {
  const $ = cheerio.load(rawHtml);
  const unavailable = $('.weui-msg .weui-msg__title, .mesg-block').first().text().replace(/\s+/g, ' ').trim();
  let content = $('#js_content').first();
  const visibleContent = content.clone();
  visibleContent.find('script, #js_top_ad_area, #js_tags_preview_toast, #content_bottom_area, #js_pc_qr_code').remove();
  const hasRenderedContent =
    content.length > 0 &&
    (visibleContent.text().trim().length > 0 || visibleContent.find('img, video, audio, iframe, table').length > 0);
  if (!hasRenderedContent) {
    if (unavailable) return { unavailable };
    const cgiData = extractCgiDataFields(rawHtml);
    if (cgiData.content) {
      $('body').append(`<div id="__wechat_export_content">${cgiData.content}</div>`);
      content = $('#__wechat_export_content');
    } else if (cgiData.itemShowType === 8 && cgiData.pictureUrls.length) {
      const pictureHtml = cgiData.pictureUrls
        .map((url, index) => `<p><img src="${url}" alt="图${index + 1}"></p>`)
        .join('');
      $('body').append(`<div id="__wechat_export_content">${pictureHtml}</div>`);
      content = $('#__wechat_export_content');
    } else if (cgiData.itemShowType === 5 && cgiData.video.id) {
      $('body').append('<div id="__wechat_export_content"></div>');
      content = $('#__wechat_export_content');
      if (cgiData.video.coverUrl) {
        const image = $('<img>').attr({ src: cgiData.video.coverUrl, alt: cgiData.title || '视频封面' });
        content.append($('<p>').append(image));
      }
      const metadata = ['微信视频', `视频 ID：${cgiData.video.id}`];
      if (cgiData.video.durationSeconds) metadata.push(`时长：${cgiData.video.durationSeconds} 秒`);
      content.append($('<p>').text(metadata.join('；')));
    } else {
      return { error: '页面中未找到微信文章正文 #js_content，且无法解析特殊消息内容' };
    }
  }

  content.removeAttr('style');
  content.find('script, #js_top_ad_area, #js_tags_preview_toast, #content_bottom_area, #js_pc_qr_code').remove();
  const title = $('#activity-name').first().text().replace(/\s+/g, ' ').trim() || $('meta[property="og:title"]').attr('content') || '';
  const author = $('#js_name').first().text().replace(/\s+/g, ' ').trim() || $('meta[name="author"]').attr('content') || '';

  const images = [];
  content.find('img').each((index, element) => {
    const image = $(element);
    const url = normalizeUrl(image.attr('data-src') || image.attr('data-backsrc') || image.attr('src'));
    if (!url) return;
    image.attr('src', url);
    image.removeAttr('data-src data-backsrc srcset');
    if (/^https?:\/\//i.test(url)) images.push({ index: index + 1, url });
  });

  return { $, content, title, author, images, unavailable: '' };
}

function extractJsDecodeProperty(script, property) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${property}:\\s*JsDecode\\('((?:\\\\.|[^'\\\\])*)'\\)`);
  const match = script.match(pattern);
  if (match) return decodeWechatJsString(match[1]);
  const singleQuoted = script.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*'((?:\\\\.|[^'\\\\])*)'`));
  if (singleQuoted) return decodeWechatJsString(singleQuoted[1]);
  const doubleQuoted = script.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  return doubleQuoted ? decodeWechatJsString(doubleQuoted[1]) : '';
}

function extractArrayBlock(script, property) {
  return extractBlock(script, property, '[', ']');
}

function extractObjectBlock(script, property) {
  return extractBlock(script, property, '{', '}');
}

function extractBlock(script, property, opening, closing) {
  const propertyIndex = script.search(new RegExp(`\\b${property}\\s*:`));
  if (propertyIndex < 0) return '';
  const start = script.indexOf(opening, propertyIndex);
  if (start < 0) return '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < script.length; index++) {
    const char = script[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === opening) depth++;
    else if (char === closing && --depth === 0) return script.slice(start, index + 1);
  }
  return '';
}

function extractNumericProperty(script, property) {
  const match = script.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*['"]?([0-9.]+)`));
  return match ? Number(match[1]) : 0;
}

function extractTopLevelObjectProperties(arrayBlock, property) {
  const values = [];
  let objectDepth = 0;
  for (const line of arrayBlock.split('\n')) {
    if (objectDepth === 1) {
      const decoded = line.match(new RegExp(`^\\s*${property}:\\s*JsDecode\\('((?:\\\\.|[^'\\\\])*)'\\)`));
      const singleQuoted = line.match(new RegExp(`^\\s*${property}:\\s*'((?:\\\\.|[^'\\\\])*)'`));
      const doubleQuoted = line.match(new RegExp(`^\\s*${property}:\\s*"((?:\\\\.|[^"\\\\])*)"`));
      const match = decoded || singleQuoted || doubleQuoted;
      if (match) values.push(decodeWechatJsString(match[1]));
    }
    let quote = '';
    let escaped = false;
    for (const char of line) {
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
      } else if (char === "'" || char === '"') quote = char;
      else if (char === '{') objectDepth++;
      else if (char === '}') objectDepth--;
    }
  }
  return values;
}

export function extractCgiDataFields(rawHtml) {
  const $ = cheerio.load(rawHtml);
  const script = $('script')
    .toArray()
    .map(element => $(element).html() || '')
    .find(content => content.includes('window.cgiDataNew ='));
  if (!script) return { title: '', content: '', itemShowType: 0, pictureUrls: [], video: { id: '', coverUrl: '', durationSeconds: 0 } };
  const itemShowType = Number(script.match(/(?:^|\n)\s*item_show_type:\s*'?(\d+)'?\s*\*?/)?.[1] || 0);
  const pictureBlock = extractArrayBlock(script, 'picture_page_info_list');
  const videoBlock = extractObjectBlock(script, 'video_page_info');
  return {
    title: extractJsDecodeProperty(script, 'title'),
    content: extractJsDecodeProperty(script, 'content_noencode'),
    itemShowType,
    pictureUrls: extractTopLevelObjectProperties(pictureBlock, 'cdn_url'),
    video: {
      id: extractJsDecodeProperty(videoBlock, 'video_id'),
      coverUrl: normalizeUrl(extractJsDecodeProperty(videoBlock, 'cover_url')),
      durationSeconds: extractNumericProperty(videoBlock, 'duration') || extractNumericProperty(videoBlock, 'vDuration'),
    },
  };
}

export async function renderMarkdown({
  rawHtml,
  article,
  account,
  articleStem,
  outputDir,
  fetchImpl = fetch,
  imageConcurrency = 4,
}) {
  const parsed = extractArticleDocument(rawHtml);
  if (parsed.unavailable) return { unavailable: parsed.unavailable };
  if (parsed.error) throw new Error(parsed.error);

  const imageDir = path.join(outputDir, 'images', articleStem);
  const imageResults = await mapLimit(parsed.images, imageConcurrency, async image => {
    if (!/^https?:\/\//i.test(image.url)) return { ...image, local: false, error: '非 HTTP 图片地址' };
    try {
      const response = await fetchImpl(image.url, {
        headers: { Referer: 'https://mp.weixin.qq.com/', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('空图片');
      const extension = extensionFrom(response.headers.get('content-type'), image.url);
      const filename = `${String(image.index).padStart(3, '0')}-${sha1(image.url).slice(0, 10)}${extension}`;
      await ensureDir(imageDir);
      await writeFile(path.join(imageDir, filename), bytes);
      return { ...image, local: true, relativePath: `../images/${articleStem}/${filename}` };
    } catch (error) {
      return { ...image, local: false, error: error.message };
    }
  });

  const localByUrl = new Map(imageResults.filter(item => item.local).map(item => [item.url, item.relativePath]));
  parsed.content.find('img').each((_, element) => {
    const image = parsed.$(element);
    const current = normalizeUrl(image.attr('src'));
    if (localByUrl.has(current)) image.attr('src', localByUrl.get(current));
  });

  const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
  turndown.keep(['video', 'audio', 'iframe', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
  const body = turndown.turndown(parsed.content.html() || '').trim();
  if (!body) throw new Error('文章正文转换后为空');
  const publishedAt = new Date(Number(article.create_time || 0) * 1000).toISOString();
  const title = article.title || parsed.title || '无标题';
  const frontmatter = [
    '---',
    `title: ${yamlString(title)}`,
    `account: ${yamlString(account.nickname)}`,
    `account_id: ${yamlString(account.original_id || account.alias)}`,
    `fakeid: ${yamlString(account.fakeid)}`,
    `author: ${yamlString(article.author_name || parsed.author)}`,
    `published_at: ${yamlString(publishedAt)}`,
    `source_url: ${yamlString(article.link)}`,
    `wechat_aid: ${yamlString(article.aid)}`,
    `item_show_type: ${Number(article.item_show_type || 0)}`,
    `exported_at: ${yamlString(new Date().toISOString())}`,
    '---',
  ].join('\n');

  return {
    markdown: `${frontmatter}\n\n# ${title}\n\n${body}\n`,
    title,
    author: article.author_name || parsed.author,
    imageCount: imageResults.length,
    imageFailures: imageResults.filter(item => !item.local),
  };
}
