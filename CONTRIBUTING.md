# Contributing

感谢你愿意帮助这个项目变得更可靠。

## 开始之前

1. 不要在 issue、测试夹具或提交中包含真实的微信 cookies、token、二维码或 `.wechat-session`。
2. 不要提交未经授权的公众号文章与图片样本。请使用最小化、脱敏后的 HTML 夹具。
3. 一个改动只解决一个清楚的问题；不要顺手重构无关代码。

## 本地验证

```bash
npm install
npm run check
npm test
```

修复解析问题时，请先补一个能复现微信页面结构的最小测试，再修改实现。新增导出格式或 enrichment 时，保持现有 Markdown 和 `manifest.json` 行为向后兼容。

## 提交建议

- 说明看到的微信消息类型或页面结构，但删掉账号和会话信息。
- 写清成功标准，以及你实际运行过的验证命令。
- 用户可见的改动同步更新 `README.md` 和 `CHANGELOG.md`。

路线图与模块边界见 [docs/EXTENDING.md](docs/EXTENDING.md)。
