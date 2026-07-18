# 来源、独立实现与差异说明

## 参考来源

MPVault 在微信公众平台登录、账号搜索、文章列表接口和特殊消息兼容性调研中参考了 MIT 许可项目 [`wechat-article-exporter`](https://github.com/wechat-article/wechat-article-exporter)。该项目验证了利用微信公众号后台搜索能力获取其他公众号公开文章列表的可行性。

## 独立实现

MPVault 当前源码是独立的 Node.js CLI 实现，没有复制上游的 Nuxt 页面、Pinia/IndexedDB 缓存、代理管理、浏览器 File System Access 下载器、多格式 exporter 或 Cloudflare/Docker 部署代码。

两者共同出现的微信接口路径、请求字段、HTML 元素 ID 与消息类型数字，是与同一微信页面交互所必需的协议事实。MPVault 自己实现了：

- 本地 CookieJar 与 `0600` 会话文件。
- 原始 ID 候选文章交叉核验。
- 以群发消息数推进的原子分页检查点。
- manifest 驱动的状态机与断点续传。
- 不执行远程 JavaScript 的 `cgiDataNew` 安全解析。
- Markdown 与本地图片的一致性校验。
- 离线全文检索与结果排序。

## 产品定位差异

上游重点是在线批量下载、多格式导出和部署方式；MPVault 的重点是本地知识资产的完整性、可恢复性、可检索性和长期演进。未来新增格式也会作为同一份标准化档案的下游 renderer，而不是重复抓取核心。

## 许可

MPVault 使用 MIT License。上游参考声明保留在 `THIRD_PARTY_NOTICES.md`；运行时依赖的许可由各 npm 包自行提供。
