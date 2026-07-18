import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 MPVault/0.1';

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sanitizeFilename(value, maxLength = 90) {
  const clean = String(value || 'untitled')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return (clean || 'untitled').slice(0, maxLength);
}

export function sha1(value) {
  return createHash('sha1').update(value).digest('hex');
}

export function decodeWechatJsString(value) {
  return String(value || '')
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export function shanghaiDate(unixSeconds) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Number(unixSeconds) * 1000));
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

export function articleKey(article) {
  return String(article.aid || article.link || `${article.appmsgid}:${article.itemidx}`);
}

export function articleStem(article) {
  const date = shanghaiDate(article.create_time || article.update_time || 0);
  const title = sanitizeFilename(article.title, 72);
  const id = sanitizeFilename(article.aid || `${article.appmsgid}-${article.itemidx}`, 36);
  return `${date}-${title}-${id}`;
}

export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}
