import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeWechatJsString, ensureDir, sleep, USER_AGENT, writeJsonAtomic } from './common.mjs';

const MP_ORIGIN = 'https://mp.weixin.qq.com';

export class WechatApiError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'WechatApiError';
    this.code = code;
  }
}

export class CookieJar {
  constructor(initial = {}) {
    this.cookies = new Map(Object.entries(initial));
  }

  absorb(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const setCookie of setCookies) {
      const first = setCookie.split(';', 1)[0];
      const separator = first.indexOf('=');
      if (separator < 1) continue;
      const name = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (!value || value === 'EXPIRED') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.cookies);
  }
}

export class WechatClient {
  constructor({ sessionDir, timeoutMs = 30000 } = {}) {
    this.sessionDir = path.resolve(sessionDir || '.wechat-session');
    this.sessionFile = path.join(this.sessionDir, 'session.json');
    this.timeoutMs = timeoutMs;
    this.jar = new CookieJar();
    this.token = null;
    this.accountNickname = null;
  }

  async loadSession() {
    let saved;
    try {
      saved = JSON.parse(await readFile(this.sessionFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`未找到登录会话：${this.sessionFile}，请先运行 login`);
      }
      throw error;
    }
    this.jar = new CookieJar(saved.cookies || {});
    this.token = saved.token || null;
    this.accountNickname = saved.accountNickname || null;
    if (!this.token || this.jar.cookies.size === 0) {
      throw new Error('登录会话不完整，请重新运行 login');
    }
    return saved;
  }

  async saveSession() {
    await ensureDir(this.sessionDir);
    await writeJsonAtomic(this.sessionFile, {
      version: 1,
      token: this.token,
      cookies: this.jar.toJSON(),
      accountNickname: this.accountNickname,
      authenticatedAt: new Date().toISOString(),
    });
    await chmod(this.sessionFile, 0o600);
  }

  async request(endpoint, { method = 'GET', query = {}, form = null, retries = 3 } = {}) {
    const url = new URL(endpoint, MP_ORIGIN);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const headers = {
          Referer: `${MP_ORIGIN}/`,
          Origin: MP_ORIGIN,
          'User-Agent': USER_AGENT,
          'Accept-Encoding': 'identity',
        };
        const cookie = this.jar.header();
        if (cookie) headers.Cookie = cookie;
        let body;
        if (form) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
          body = new URLSearchParams(Object.entries(form).map(([key, value]) => [key, String(value)])).toString();
        }
        const response = await fetch(url, {
          method,
          headers,
          body,
          redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        this.jar.absorb(response);
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < retries - 1) await sleep(1000 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  async requestJson(endpoint, options) {
    const response = await this.request(endpoint, options);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`微信接口未返回 JSON：${text.slice(0, 200)}`);
    }
  }

  async beginLogin() {
    this.jar = new CookieJar();
    const sessionId = `${Date.now()}${Math.floor(Math.random() * 100)}`;
    const result = await this.requestJson('/cgi-bin/bizlogin', {
      method: 'POST',
      query: { action: 'startlogin' },
      form: {
        userlang: 'zh_CN',
        redirect_url: '',
        login_type: 3,
        sessionid: sessionId,
        token: '',
        lang: 'zh_CN',
        f: 'json',
        ajax: 1,
      },
    });
    this.assertBaseResponse(result, '创建登录会话失败');
  }

  async downloadLoginQr(file) {
    const response = await this.request('/cgi-bin/scanloginqrcode', {
      query: { action: 'getqrcode', random: Date.now() },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    await ensureDir(path.dirname(file));
    await writeFile(file, bytes);
    return file;
  }

  async pollLogin({ onStatus = () => {}, pollMs = 2000, timeoutMs = 5 * 60 * 1000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.requestJson('/cgi-bin/scanloginqrcode', {
        query: { action: 'ask', token: '', lang: 'zh_CN', f: 'json', ajax: 1 },
      });
      this.assertBaseResponse(result, '检查扫码状态失败');
      onStatus(result);
      if (result.status === 1) return result;
      if ([2, 3].includes(result.status)) throw new Error('二维码已过期，请重新运行 login');
      if (result.status === 5) throw new Error('扫码微信账号尚未绑定邮箱');
      await sleep(pollMs);
    }
    throw new Error('扫码登录等待超时，请重新运行 login');
  }

  async finishLogin() {
    const result = await this.requestJson('/cgi-bin/bizlogin', {
      method: 'POST',
      query: { action: 'login' },
      form: {
        userlang: 'zh_CN',
        redirect_url: '',
        cookie_forbidden: 0,
        cookie_cleaned: 0,
        plugin_used: 0,
        login_type: 3,
        token: '',
        lang: 'zh_CN',
        f: 'json',
        ajax: 1,
      },
    });
    this.assertBaseResponse(result, '完成登录失败');
    if (!result.redirect_url) throw new Error('登录响应中缺少 redirect_url');
    this.token = new URL(result.redirect_url, 'http://localhost').searchParams.get('token');
    if (!this.token) throw new Error('登录响应中缺少 token');
    this.accountNickname = await this.fetchLoginAccountNickname();
    await this.saveSession();
    return { nickname: this.accountNickname, sessionFile: this.sessionFile };
  }

  async fetchLoginAccountNickname() {
    const response = await this.request('/cgi-bin/home', {
      query: { t: 'home/index', token: this.token, lang: 'zh_CN' },
    });
    const html = await response.text();
    return html.match(/wx\.cgiData\.nick_name\s*=\s*"([^"]+)"/)?.[1] || '未知公众号';
  }

  async searchAccounts(keyword) {
    const accounts = [];
    const pageSize = 5;
    for (let begin = 0; ; begin += pageSize) {
      const result = await this.requestJson('/cgi-bin/searchbiz', {
        query: {
          action: 'search_biz',
          begin,
          count: pageSize,
          query: keyword,
          token: this.token,
          lang: 'zh_CN',
          f: 'json',
          ajax: 1,
        },
      });
      this.assertBaseResponse(result, '搜索公众号失败');
      const page = result.list || [];
      accounts.push(...page);
      if (page.length < pageSize || result.total === 0) break;
    }
    return accounts;
  }

  async findExactAccount(alias, nickname = '') {
    const queries = [...new Set([alias, nickname].filter(Boolean))];
    const seen = new Map();
    for (const query of queries) {
      for (const account of await this.searchAccounts(query)) seen.set(account.fakeid, account);
      const exact = [...seen.values()].find(account => account.alias === alias);
      if (exact) return { ...exact, original_id: alias };
    }

    const candidates = [...seen.values()].sort((left, right) => {
      return Number(right.nickname === nickname) - Number(left.nickname === nickname);
    });
    for (const account of candidates) {
      try {
        const page = await this.fetchArticlePage(account.fakeid, 0, 1);
        const firstArticle = page.articles.find(article => article.link);
        if (!firstArticle) continue;
        const response = await this.request(firstArticle.link);
        const originalId = extractOriginalIdFromHtml(await response.text());
        if (originalId === alias) return { ...account, original_id: originalId };
      } catch (error) {
        console.warn(`无法核验候选公众号 ${account.nickname}：${error.message}`);
      }
    }

    const candidateLabel = candidates.map(account => `${account.nickname} (微信号: ${account.alias || '未设置'})`).join('、');
    throw new Error(`未找到原始 ID 为 ${alias} 的公众号${candidateLabel ? `；已核验候选：${candidateLabel}` : ''}`);
  }

  async fetchArticlePage(fakeid, begin, size = 20) {
    const result = await this.requestJson('/cgi-bin/appmsgpublish', {
      query: {
        sub: 'list',
        search_field: 'null',
        begin,
        count: size,
        query: '',
        fakeid,
        type: '101_1',
        free_publish_type: 1,
        sub_action: 'list_ex',
        token: this.token,
        lang: 'zh_CN',
        f: 'json',
        ajax: 1,
      },
    });
    this.assertBaseResponse(result, '获取文章列表失败');
    let page;
    try {
      page = JSON.parse(result.publish_page);
    } catch {
      throw new Error('微信文章列表响应缺少 publish_page');
    }
    return parsePublishPage(page);
  }

  assertBaseResponse(result, label) {
    const code = result?.base_resp?.ret;
    if (code === 0) return;
    if (code === 200003) throw new WechatApiError('公众号后台登录已过期，请重新运行 login', code);
    if (code === 200013) {
      throw new WechatApiError('微信文章列表触发频率限制；检查点已保存，请稍后用同一命令续传', code);
    }
    throw new WechatApiError(`${label}：${code ?? 'unknown'} ${result?.base_resp?.err_msg || ''}`.trim(), code);
  }
}

export function parsePublishPage(page) {
  const publishList = (page.publish_list || []).filter(item => item.publish_info);
  const messages = [];
  const articles = [];
  for (const item of publishList) {
    const info = JSON.parse(item.publish_info);
    messages.push(info);
    for (const article of info.appmsgex || []) articles.push(article);
  }
  return {
    articles,
    messageCount: articles.filter(article => Number(article.itemidx) === 1).length || messages.length,
    rawMessageCount: publishList.length,
    totalCount: Number(page.total_count || 0),
  };
}

export function extractOriginalIdFromHtml(html) {
  const decoded = html.match(/\buser_name\s*:\s*JsDecode\('((?:\\.|[^'\\])*)'\)/);
  if (decoded) return decodeWechatJsString(decoded[1]);
  const literal = html.match(/\buser_name\s*:\s*(['"])(gh_[a-z0-9]+)\1/i);
  if (literal) return literal[2];
  return html.match(/\buser_name\s*=\s*(['"])(gh_[a-z0-9]+)\1/i)?.[2] || '';
}
