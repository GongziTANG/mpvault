# 扩展指南

## 原则

当前版本优先把“保存、校验、检索”做可靠，不为未实现功能预建复杂插件系统。现有模块已经形成六个清楚阶段：

```text
登录与账号核验 → 列表同步 → 正文解析 → 资源落盘与渲染 → 清单校验 → 本地检索
```

新增功能应落在对应阶段，并以 `manifest.json` 作为最终事实来源。不要让某个附加功能的失败破坏已经成功的原文归档。

## 现有扩展点

| 需求 | 主要文件 | 最小实现路径 | 必须验证 |
| --- | --- | --- | --- |
| 标题/作者/日期/原创/合集筛选 | `src/exporter.mjs` | 列表同步后、下载前生成稳定选择集 | 续传时选择结果不漂移 |
| HTML / JSON / TXT 导出 | 新建 `src/renderers/` | 复用解析结果和本地资源，不重复请求文章 | 各格式条目数与 manifest 一致 |
| Docx / PDF | 新建 renderer | 从标准中间文档生成，不直接耦合微信 HTML | 图片、分页和中文字体可复现 |
| 视频/音频本地化 | `src/markdown.mjs` + `src/assets/` | 把资源下载从图片推广为通用 asset pipeline | 原链接、失败原因和本地文件均有记录 |
| 合集 | `src/wechat-client.mjs` | 把合集元数据加入列表记录和 frontmatter | 跨页去重、合集顺序稳定 |
| 阅读/点赞/转发/评论 | 新建 `src/metrics-client.mjs` | 使用独立短期 credentials 与独立 sidecar | credentials 不进 manifest、日志或 Git |
| RSS / API | 读取 `manifest.json` | 作为只读下游，不进入抓取核心 | 不需要重新登录或请求微信 |
| OCR | `src/enrichers/ocr.mjs` | 在资源落盘后运行可选 enrichment | 关闭时零行为变化，失败不影响归档 |
| 高级检索/本地 UI | `src/library.mjs` | 读取 manifest 与 Markdown，不进入抓取核心 | 不联网、不改变档案文件 |

## 推荐实现顺序

1. **筛选与 JSON/HTML renderer**：数据已经存在，风险最低，也能验证 renderer 边界。
2. **视频/音频资源管线**：把当前图片下载抽成通用 asset 模块，再添加媒体类型。
3. **合集、RSS、只读 API 与本地 UI**：基于稳定 manifest 和搜索模块增量实现。
4. **选择性 OCR**：按 [OCR-STRATEGY.md](OCR-STRATEGY.md) 实现 `off / auto / all`。
5. **统计与评论**：最后处理；它依赖更敏感、更短期的 credentials，安全边界与正文抓取不同。

## 兼容性约束

- `manifest.json` 新字段只能增量添加；已有字段含义不可静默改变。
- 文章唯一键继续使用微信 `aid`，文件名改变时必须有迁移策略。
- 新 renderer 读取同一份标准化文章对象，不能各自重新解析微信脚本。
- 新 enrichment 写 sidecar 或可选 frontmatter；默认关闭时输出必须与当前版本一致。
- 只有微信明确展示的删除/违规/暂不可用提示才能进入 terminal 状态；解析不到正文是 `failed`，不能伪装成“不可用”。

每项扩展先加最小脱敏夹具测试，再写实现；最后必须运行 `npm run check`、`npm test` 和一次 `verify` 回归。
