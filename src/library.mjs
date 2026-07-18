import { readFile } from 'node:fs/promises';
import path from 'node:path';

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function countOccurrences(text, term) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(term, offset)) >= 0) {
    count++;
    offset += term.length;
  }
  return count;
}

function bodyText(markdown) {
  return String(markdown)
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '')
    .replace(/^# .*\n?/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetFor(markdown, terms, radius = 90) {
  const text = bodyText(markdown);
  const normalized = normalize(text);
  const indexes = terms.map(term => normalized.indexOf(term)).filter(index => index >= 0);
  const hit = indexes.length ? Math.min(...indexes) : 0;
  const start = Math.max(0, hit - radius);
  const end = Math.min(text.length, hit + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export async function searchArchive(outputDir, query, { limit = 20 } = {}) {
  const terms = [...new Set(normalize(query).split(/\s+/).filter(Boolean))];
  if (!terms.length) throw new Error('搜索关键词不能为空');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('搜索数量必须是正整数');

  const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  const matches = [];
  for (const entry of manifest.articles.filter(item => item.status === 'exported' && item.file)) {
    const markdown = await readFile(path.join(outputDir, entry.file), 'utf8');
    const title = entry.title || '无标题';
    const normalizedTitle = normalize(title);
    const searchable = normalize(`${title}\n${markdown}`);
    if (!terms.every(term => searchable.includes(term))) continue;
    const bodyHits = terms.reduce((sum, term) => sum + countOccurrences(searchable, term), 0);
    const titleHits = terms.reduce((sum, term) => sum + (normalizedTitle.includes(term) ? 10 : 0), 0);
    matches.push({
      title,
      publishedAt: entry.publishedAt || '',
      file: entry.file,
      sourceUrl: entry.sourceUrl || '',
      score: titleHits + bodyHits,
      snippet: snippetFor(markdown, terms),
    });
  }

  matches.sort((left, right) => right.score - left.score || right.publishedAt.localeCompare(left.publishedAt));
  return {
    query: String(query).trim(),
    terms,
    totalMatches: matches.length,
    results: matches.slice(0, limit),
  };
}
