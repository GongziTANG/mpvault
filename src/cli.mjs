#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { exportArticles, syncArticleList, verifyExport } from './exporter.mjs';
import { searchArchive } from './library.mjs';
import { WechatClient } from './wechat-client.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) options[key] = true;
    else {
      options[key] = next;
      index++;
    }
  }
  return { command, options };
}

function numberOption(value, fallback, label) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} 必须是非负数`);
  return number;
}

function usage() {
  console.log(`用法：
  mpvault login [--session-dir PATH]
  mpvault export --account gh_xxx --name 公众号名 --output PATH [--delay-ms 5000] [--concurrency 2] [--refresh]
  mpvault search --output PATH --query 关键词 [--limit 20] [--json]
  mpvault verify --output PATH`);
}

async function login(options) {
  const sessionDir = path.resolve(options.sessionDir || '.wechat-session');
  const client = new WechatClient({ sessionDir });
  await client.beginLogin();
  const qrFile = path.join(sessionDir, 'login-qr.png');
  await client.downloadLoginQr(qrFile);
  console.log(`QR_READY ${qrFile}`);
  console.log('请用微信扫码，并在手机上选择一个公众号或服务号后确认登录。');
  let lastStatus = null;
  await client.pollLogin({
    onStatus(result) {
      if (result.status === lastStatus) return;
      lastStatus = result.status;
      if ([4, 6].includes(result.status)) console.log(`已扫码，等待手机确认（可登录账号数：${result.acct_size || 0}）`);
    },
  });
  const result = await client.finishLogin();
  console.log(`LOGIN_OK ${result.nickname}`);
  console.log(`会话已保存：${result.sessionFile}`);
}

async function exportAccount(options) {
  if (!options.account) throw new Error('缺少 --account（例如 gh_xxx）');
  if (!options.output) throw new Error('缺少 --output');
  const outputDir = path.resolve(options.output);
  const sessionDir = path.resolve(options.sessionDir || '.wechat-session');
  const delayMs = numberOption(options.delayMs, 5000, '--delay-ms');
  const concurrency = numberOption(options.concurrency, 2, '--concurrency');
  const client = new WechatClient({ sessionDir });
  await client.loadSession();
  console.log(`已加载登录会话：${client.accountNickname}`);
  const account = await client.findExactAccount(options.account, options.name || '');
  console.log(`已锁定公众号：${account.nickname} (${account.alias}) fakeid=${account.fakeid}`);

  const { state } = await syncArticleList({
    client,
    account,
    outputDir,
    delayMs,
    refresh: Boolean(options.refresh),
    onProgress(progress) {
      console.log(`LIST_PROGRESS begin=${progress.begin} articles=${progress.articleCount} reported_messages=${progress.totalMessageCount}`);
    },
  });
  console.log(`LIST_OK articles=${Object.keys(state.articles).length} reported_messages=${state.totalMessageCount}`);

  const manifest = await exportArticles({
    account,
    state,
    outputDir,
    concurrency,
    onProgress({ completed, total, entry }) {
      console.log(`ARTICLE_PROGRESS ${completed}/${total} ${entry.status} ${entry.title || entry.key}`);
    },
  });
  const report = await verifyExport(outputDir);
  console.log(`EXPORT_DONE ${JSON.stringify(report)}`);
  if (!report.ok) process.exitCode = 2;
  return manifest;
}

async function verify(options) {
  if (!options.output) throw new Error('缺少 --output');
  const report = await verifyExport(path.resolve(options.output));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

async function search(options) {
  if (!options.output) throw new Error('缺少 --output');
  if (!options.query || options.query === true) throw new Error('缺少 --query');
  const limit = numberOption(options.limit, 20, '--limit');
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit 必须是正整数');
  const result = await searchArchive(path.resolve(options.output), String(options.query), { limit });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`SEARCH_DONE query=${JSON.stringify(result.query)} matches=${result.totalMatches}`);
  for (const [index, item] of result.results.entries()) {
    console.log(`${index + 1}. ${item.publishedAt?.slice(0, 10) || '日期未知'} ${item.title}`);
    console.log(`   ${item.file}`);
    console.log(`   ${item.snippet}`);
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || ['help', '--help', '-h'].includes(command)) return usage();
  if (command === 'login') return login(options);
  if (command === 'export') return exportAccount(options);
  if (command === 'search') return search(options);
  if (command === 'verify') return verify(options);
  throw new Error(`未知命令：${command}`);
}

main().catch(error => {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
});
