import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { articleKey, articleStem, ensureDir, mapLimit, sleep, USER_AGENT, writeJsonAtomic } from './common.mjs';
import { renderMarkdown } from './markdown.mjs';

export async function syncArticleList({ client, account, outputDir, delayMs = 5000, refresh = false, onProgress = () => {} }) {
  const stateFile = path.join(outputDir, '.state', 'sync.json');
  await ensureDir(path.dirname(stateFile));
  let state = {
    version: 1,
    account,
    begin: 0,
    completed: false,
    totalMessageCount: 0,
    articles: {},
    updatedAt: new Date().toISOString(),
  };
  try {
    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    if (saved.account?.fakeid === account.fakeid) state = saved;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (refresh) {
    state.begin = 0;
    state.completed = false;
  }
  if (state.completed && !refresh) return { state, stateFile };

  while (!state.completed) {
    const page = await client.fetchArticlePage(account.fakeid, state.begin, 20);
    for (const article of page.articles) state.articles[articleKey(article)] = article;
    state.totalMessageCount = page.totalCount || state.totalMessageCount;
    state.updatedAt = new Date().toISOString();

    if (page.rawMessageCount === 0) {
      state.completed = true;
    } else {
      if (page.messageCount <= 0) throw new Error(`文章列表分页未前进（begin=${state.begin}）`);
      state.begin += page.messageCount;
    }
    await writeJsonAtomic(stateFile, state);
    onProgress({ begin: state.begin, articleCount: Object.keys(state.articles).length, totalMessageCount: state.totalMessageCount });
    if (!state.completed) await sleep(delayMs);
  }
  return { state, stateFile };
}

export async function fetchArticleHtml(url, { retries = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url.replaceAll('&amp;', '&'), {
        headers: { Referer: 'https://mp.weixin.qq.com/', 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (!html.trim()) throw new Error('空响应');
      return html;
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

function initialManifest(account, state) {
  const articles = Object.values(state.articles)
    .sort((a, b) => Number(b.create_time || 0) - Number(a.create_time || 0))
    .map(article => ({
      key: articleKey(article),
      aid: article.aid,
      title: article.title || '',
      author: article.author_name || '',
      publishedAt: new Date(Number(article.create_time || 0) * 1000).toISOString(),
      sourceUrl: article.link,
      itemShowType: Number(article.item_show_type || 0),
      listedDeleted: Boolean(article.is_deleted),
      status: 'pending',
      file: null,
      imageCount: 0,
      imageFailures: [],
      error: null,
    }));
  return {
    version: 1,
    account,
    listCompleted: state.completed,
    reportedMessageCount: state.totalMessageCount,
    articleCount: articles.length,
    generatedAt: new Date().toISOString(),
    articles,
  };
}

export async function loadOrCreateManifest(account, state, outputDir) {
  const file = path.join(outputDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    manifest = initialManifest(account, state);
  }

  const existing = new Map(manifest.articles.map(entry => [entry.key, entry]));
  const refreshed = initialManifest(account, state);
  refreshed.articles = refreshed.articles.map(entry => ({ ...entry, ...(existing.get(entry.key) || {}) }));
  refreshed.articleCount = refreshed.articles.length;
  await writeJsonAtomic(file, refreshed);
  return { manifest: refreshed, file };
}

export async function exportArticles({
  account,
  state,
  outputDir,
  concurrency = 2,
  articleDelayMs = 300,
  onProgress = () => {},
}) {
  await ensureDir(path.join(outputDir, 'articles'));
  const { manifest, file: manifestFile } = await loadOrCreateManifest(account, state, outputDir);
  const rawByKey = new Map(Object.values(state.articles).map(article => [articleKey(article), article]));
  for (const entry of manifest.articles.filter(item => item.status === 'exported')) {
    try {
      const file = path.join(outputDir, entry.file || '');
      await stat(file);
      if (!hasMeaningfulMarkdownBody(await readFile(file, 'utf8'))) {
        entry.status = 'pending';
        entry.error = '已导出 Markdown 正文为空，等待重新解析';
      }
    } catch {
      entry.status = 'pending';
      entry.error = '已导出文件缺失，等待重新下载';
    }
  }
  const pending = manifest.articles.filter(entry => {
    if (['deleted', 'unavailable'].includes(entry.status)) return false;
    return entry.status !== 'exported' || (entry.imageFailures?.length || 0) > 0;
  });
  let completed = manifest.articles.length - pending.length;
  let saveChain = Promise.resolve();
  const save = () => {
    saveChain = saveChain.then(() => {
      manifest.generatedAt = new Date().toISOString();
      return writeJsonAtomic(manifestFile, manifest);
    });
    return saveChain;
  };

  await mapLimit(pending, concurrency, async entry => {
    const article = rawByKey.get(entry.key);
    try {
      if (!article?.link) throw new Error('文章列表记录缺少链接');
      const stem = articleStem(article);
      const rawHtml = await fetchArticleHtml(article.link);
      const rendered = await renderMarkdown({ rawHtml, article, account, articleStem: stem, outputDir });
      if (rendered.unavailable) {
        entry.status = /删除|deleted/i.test(rendered.unavailable) ? 'deleted' : 'unavailable';
        entry.error = rendered.unavailable;
      } else {
        const relativeFile = `articles/${stem}.md`;
        await writeFile(path.join(outputDir, relativeFile), rendered.markdown, 'utf8');
        entry.status = 'exported';
        entry.file = relativeFile;
        entry.title = rendered.title;
        entry.author = rendered.author;
        entry.imageCount = rendered.imageCount;
        entry.imageFailures = rendered.imageFailures;
        entry.error = null;
      }
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message;
    }
    entry.processedAt = new Date().toISOString();
    const completedNow = ++completed;
    await save();
    onProgress({ completed: completedNow, total: manifest.articles.length, entry });
    if (articleDelayMs > 0) await sleep(articleDelayMs);
  });
  await saveChain;
  await writeIndex(outputDir, manifest);
  return manifest;
}

export async function writeIndex(outputDir, manifest) {
  const groups = { exported: [], deleted: [], unavailable: [], failed: [], pending: [] };
  for (const entry of manifest.articles) (groups[entry.status] || groups.pending).push(entry);
  const lines = [
    `# ${manifest.account.nickname}文章归档`,
    '',
    `- 原始 ID：\`${manifest.account.alias}\``,
    `- 列表文章数：${manifest.articleCount}`,
    `- 已导出：${groups.exported.length}`,
    `- 已删除：${groups.deleted.length}`,
    `- 暂不可用：${groups.unavailable.length}`,
    `- 失败：${groups.failed.length}`,
    '',
    '## 文章',
    '',
  ];
  for (const entry of groups.exported) {
    lines.push(`- ${entry.publishedAt.slice(0, 10)} [${entry.title}](${encodeURI(entry.file)})`);
  }
  if (groups.deleted.length || groups.unavailable.length || groups.failed.length) {
    lines.push('', '## 未导出条目', '');
    for (const entry of [...groups.deleted, ...groups.unavailable, ...groups.failed]) {
      lines.push(`- \`${entry.status}\` ${entry.title || entry.sourceUrl}：${entry.error || ''}`);
    }
  }
  await writeFile(path.join(outputDir, 'INDEX.md'), `${lines.join('\n')}\n`, 'utf8');
}

export async function verifyExport(outputDir) {
  const manifestFile = path.join(outputDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const missingFiles = [];
  const emptyFiles = [];
  const emptyBodyFiles = [];
  const missingImages = [];
  let localImageRefs = 0;
  for (const entry of manifest.articles.filter(item => item.status === 'exported')) {
    const file = path.join(outputDir, entry.file || '');
    try {
      const info = await stat(file);
      if (info.size === 0) emptyFiles.push(entry.file);
      const markdown = await readFile(file, 'utf8');
      if (!hasMeaningfulMarkdownBody(markdown)) emptyBodyFiles.push(entry.file);
      for (const relativeImage of extractLocalImageRefs(markdown)) {
        localImageRefs++;
        try {
          await stat(path.resolve(path.dirname(file), relativeImage));
        } catch {
          missingImages.push({ article: entry.file, image: relativeImage });
        }
      }
    } catch {
      missingFiles.push(entry.file || entry.key);
    }
  }
  const statusCounts = {};
  for (const entry of manifest.articles) statusCounts[entry.status] = (statusCounts[entry.status] || 0) + 1;
  const imageFailures = manifest.articles.reduce((sum, entry) => sum + (entry.imageFailures?.length || 0), 0);
  const report = {
    account: manifest.account,
    listCompleted: Boolean(manifest.listCompleted),
    articleCount: manifest.articles.length,
    statusCounts,
    missingFiles,
    emptyFiles,
    emptyBodyFiles,
    localImageRefs,
    missingImages,
    imageFailures,
    ok:
      Boolean(manifest.listCompleted) &&
      !statusCounts.failed &&
      !statusCounts.pending &&
      missingFiles.length === 0 &&
      emptyFiles.length === 0 &&
      emptyBodyFiles.length === 0 &&
      missingImages.length === 0 &&
      imageFailures === 0,
    verifiedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(path.join(outputDir, 'verification.json'), report);
  return report;
}

export function hasMeaningfulMarkdownBody(markdown) {
  const withoutFrontmatter = String(markdown).replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
  return withoutFrontmatter.replace(/^# .*\n?/, '').trim().length > 0;
}

export function extractLocalImageRefs(markdown) {
  const refs = [];
  const imagePattern = /!\[[^\]]*\]\((?:<([^>]+)>|((?:\\.|[^\s)])+))(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(imagePattern)) {
    const raw = match[1] || match[2] || '';
    if (!raw.startsWith('../images/')) continue;
    const unescaped = raw.replace(/\\([\\`()\[\]{}])/g, '$1');
    try {
      refs.push(decodeURI(unescaped));
    } catch {
      refs.push(unescaped);
    }
  }
  return refs;
}
