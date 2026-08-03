# 版本日志

遵循 Keep a Changelog 的简化格式。日期以发布或固化日期为准。

## v1.0 - AI 穿搭链路可用版本

### 新增与完成

- 完成 Flutter 与 Node.js 的真实 AI 穿搭联调。
- 接入 DashScope OpenAI Compatible API，使用 `qwen-vl-plus` 进行图片分析。
- 实现 `POST /outfit` 的图片上传、参数校验、结构化 JSON 解析与 Flutter 结果展示。
- 统一 Flutter 与后端的 `bodyProfile`、`style`、`recommendations`、`products` 契约。
- 完成 Android 模拟器访问本机 Node 服务的 `10.0.2.2` 适配。
- 保留可控 Mock 降级路径，不影响已配置环境的真实 AI 调用。
- 增加超时、错误 JSON、请求 ID、脱敏日志和测试覆盖。

### 验证

- `flutter analyze` 通过。
- Flutter 测试通过。
- `npm test` 通过。
- 真实 `/outfit` 请求返回 HTTP 200 且 `analysisMode=ai`。

### 固化标记

- Commit: `1539675b1afb4899ff3db0a1c3833a277f7e107c`
- Tag: `v1.0-ai-outfit-working`

