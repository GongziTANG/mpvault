<p align="center">
  <img src="docs/assets/banner.svg" alt="MPVault" width="860">
</p>

<p align="center">
  <strong>把公众号，变成你的本地知识库。</strong><br>
  批量保存全部可访问文章与图片，随时搜索，并用一份校验报告证明没有悄悄漏掉。
</p>

<p align="center">
  <a href="https://github.com/GongziTANG/mpvault/actions/workflows/ci.yml"><img src="https://github.com/GongziTANG/mpvault/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/GongziTANG/mpvault/blob/main/LICENSE"><img src="https://img.shields.io/github/license/GongziTANG/mpvault" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22+">
  <a href="https://github.com/GongziTANG/mpvault/stargazers"><img src="https://img.shields.io/github/stars/GongziTANG/mpvault?style=social" alt="GitHub Stars"></a>
</p>

## 你的收藏，不该只活在平台里

你可能收藏了一个公众号几年，却仍然面临这些问题：文章会删除，图片外链会失效，微信搜索不适合研究，普通下载工具又很难告诉你“到底漏没漏”。

MPVault 把一次归档拆成四个可验证的结果：

| 你真正关心的事 | MPVault 怎么做 |
| --- | --- |
| 别抓错同名账号 | 用 `gh_...` 原始 ID 核验目标，而不是只看名称和头像 |
| 中断后别从头再来 | 列表逐页保存检查点，正文逐篇更新 manifest |
| 图片以后也能打开 | 下载到本地并重写 Markdown 引用 |
| 我怎么知道没漏 | 独立检查空正文、缺失文件、丢图、失败和未完成状态 |
| 几年文章怎么找 | 直接在本地档案里做多关键词全文检索 |

它适合研究者、内容创作者、知识管理用户，以及需要保存机构内容资产的团队。

## 5 分钟拥有第一座内容库

需要 Node.js 22 或更高版本，以及一个你能扫码登录的公众号或服务号后台账号。扫码只是为了使用该账号自身可访问的微信公众平台能力；不能选择小程序。

```bash
git clone https://github.com/GongziTANG/mpvault.git
cd mpvault
npm install
```

### 1. 登录一次

```bash
npm exec mpvault -- login
```

终端会输出二维码文件路径。扫码并在手机上选择一个公众号或服务号后确认。会话只保存在本机 `.wechat-session/`，文件权限为 `0600`。

### 2. 把目标公众号带回本地

```bash
npm exec mpvault -- export \
  --account gh_xxx \
  --name "目标公众号" \
  --output ./exports/my-library
```

`--account` 必须填写目标公众号原始 ID；`--name` 只辅助搜索。命令被打断时，重新运行同一条命令即可续传。

### 3. 搜你真正想找的内容

```bash
npm exec mpvault -- search \
  --output ./exports/my-library \
  --query "人工智能 教育"
```

多个关键词采用 AND 匹配，标题命中优先。加上 `--json` 可把结果交给脚本、知识库或 AI 工作流。

### 4. 让工具证明归档完整

```bash
npm exec mpvault -- verify --output ./exports/my-library
```

只有列表完成、没有失败/待处理、没有空正文、所有 Markdown 和本地图片都存在时，才会返回 `"ok": true`。微信明确标记为删除或不可访问的记录会单独列出，不会被伪装成成功文章。

## 你会得到什么

```text
my-library/
├── INDEX.md                 # 可浏览目录
├── manifest.json            # 每条记录的最终状态
├── verification.json        # 完整性证明
├── articles/
│   └── 2026-01-01-文章标题-aid.md
├── images/
│   └── 2026-01-01-文章标题-aid/
└── .state/
    └── sync.json            # 断点续传检查点
```

每篇文章带 YAML frontmatter，包括标题、公众号、作者、发布时间、来源链接和微信文章 ID，适合继续导入 Obsidian、静态站点、全文索引或数据分析管线。

## 已经能用，下一步由你投票

MPVault 的方向不是堆格式，而是完成一条完整内容生命线：**带回来 → 保存好 → 找得到 → 用起来**。

| 状态 | 能力 |
| --- | --- |
| ✅ 已有 | 全量 Markdown、本地图片、断点续传、精确账号核验、manifest、完整性校验、离线搜索、Codex Skill |
| 🗳️ 候选 | HTML 原排版、JSON / Excel / Docx / PDF、多条件筛选、合集、视频音频 |
| 🗳️ 候选 | 增量订阅、定时备份、RSS、图片去重与存储瘦身 |
| 🗳️ 候选 | Obsidian MOC、选择性 OCR、语义搜索与带原文引用的 AI 问答 |
| 🗳️ 候选 | 阅读/点赞/转发/评论、Docker、只读 API、本地阅读界面 |

去 [Roadmap Issues](https://github.com/GongziTANG/mpvault/issues?q=is%3Aissue%20label%3Aroadmap) 给最想要的能力点 👍。我们按用户价值、票数、实现成本和隐私风险排序，而不是按作者一时兴起排期。完整产品清单见 [ROADMAP.md](docs/ROADMAP.md)。

如果你暂时没空提需求，点一个 ⭐ Star 就是最简单的一票。

## 图片 OCR：为什么没有默认全开

公众号图片里有大量二维码、宣传海报、装饰字和正文重复截图。盲目 OCR 会污染全文搜索，所以当前默认关闭。

未来推荐的 `auto` 模式只识别图片分享、图片承担正文或用户点选内容；原图始终是事实来源，OCR 先写 sidecar，高置信度结果才折叠进入 Markdown。详见 [OCR-STRATEGY.md](docs/OCR-STRATEGY.md)。

## 直接交给 Codex

仓库自带 `$mpvault-archive` Skill。安装后可以直接说：

> 使用 `$mpvault-archive`，把这个公众号完整保存成可搜索的 Markdown 知识库，并验证完整性。

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/mpvault-archive" ~/.codex/skills/mpvault-archive
```

Skill 从当前仓库运行 `npm exec mpvault`，不需要 sudo 或全局 npm 安装。

## 安全与边界

- `.wechat-session/`、`exports/` 和二维码默认不进入 Git。
- `manifest.json` 会包含目标账号和文章元数据，不应随意公开。
- 不使用公共代理或账号池，不把你的登录账号提供给其他用户。
- 不绕过付费、删除、违规或其他访问限制。
- 统计与评论依赖另一套更敏感的短期凭据，当前版本不采集。

如果遇到 `200013 freq control`，保留输出目录，等待后重新运行同一条命令。更多恢复方法见 Skill 的 [recovery reference](skills/mpvault-archive/references/recovery.md)。安全报告方式见 [SECURITY.md](SECURITY.md)。

## 与其他项目的关系

MPVault 是独立的 Node.js CLI 实现，核心架构是本地会话、原子检查点、状态清单、确定性校验和离线检索。项目在微信接口兼容性调研中参考了 MIT 许可的 `wechat-article-exporter`，没有复制其 Nuxt 页面、缓存层、下载器或导出模块。共同出现的接口路径和 DOM 选择器来自同一微信页面协议。

完整差异与来源说明见 [PROVENANCE.md](docs/PROVENANCE.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目与腾讯或微信官方无隶属、认可或合作关系。

## 开发

```bash
npm run check
npm test
```

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [EXTENDING.md](docs/EXTENDING.md)。

## 让值得留下的内容，真的留下

如果 MPVault 帮你把散落在平台里的文章变成了自己的知识资产，欢迎点亮右上角的 ⭐。Star 不只是鼓励，也会帮助更多有同样归档需求的人找到它。

MIT © 2026 [GongziTANG](https://github.com/GongziTANG)
