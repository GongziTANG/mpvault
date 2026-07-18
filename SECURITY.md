# Security

## 登录会话

`.wechat-session/session.json` 含有微信公众平台登录 cookies 和 token，应视同密码：

- 只保存在本机；工具会把文件权限设置为 `0600`。
- 不要上传到 GitHub、网盘、日志、issue 或聊天记录。
- 仓库已忽略 `.wechat-session/`，但提交前仍应检查暂存文件。
- 如果会话意外泄漏，请立即在微信公众平台退出相关登录，并重新登录生成新会话。

## 报告漏洞

请通过 GitHub Security Advisory 私下报告可导致会话泄漏、任意文件写入或目标公众号核验绕过的问题。不要在公开 issue 中附带真实凭据或文章内容。
