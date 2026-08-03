# 开发记录

## 项目概述

树皮 Shupi（原 FitAI）是一个 AI 穿搭推荐平台。当前稳定版本已经完成真实 AI 穿搭生成：用户上传全身照片并提交身高、体重与场景，Flutter 通过 Node 后端调用 DashScope `qwen-vl-plus`，接收结构化结果后展示穿搭报告和推荐商品。

## 当前已完成

- Flutter 前端及 AI 穿搭页面。
- Node.js Express 后端与 `POST /outfit`。
- 正面、侧面、背面图片的文件选择、预览、校验与上传。
- Android 模拟器调试与本机后端访问适配。
- DashScope OpenAI Compatible 接入，默认模型为 `qwen-vl-plus`。
- 真实 AI 图片分析与结构化 JSON 解析。
- Flutter 对 `bodyProfile`、`style`、`recommendations`、`products` 的解析与展示。
- Mock 仅作为无 Key、显式强制或受控故障时的降级路径；当前可用环境为 `analysisMode=ai`。
- `flutter analyze`、Flutter 测试与 Node 测试均已在 v1.0 固化前通过。

## 已解决的关键问题

| 问题 | 最终解决方案 |
| --- | --- |
| Android 模拟器访问 `localhost` 失败 | 在 `AppConfig` 中将 Android 的 `localhost` / `127.0.0.1` 转换为 `http://10.0.2.2:3000`；也支持 `API_BASE_URL` 显式传入。 |
| 模拟器 Photo Picker 看不到导入图片 | Android 图片选择优先使用 Files 文件选择器，保留 `image_picker` 给相机流程。 |
| 后端请求字段导致 `/outfit` 400 | Flutter 请求统一为 `height`、`weight`、`scene`、`request`、`images.front/side/back`，并与后端校验一致。 |
| DashScope 地址或模型不一致 | 后端从 `AI_BASE_URL` 与 `AI_MODEL` 读取配置，默认值分别为 DashScope Compatible URL 与 `qwen-vl-plus`。 |
| Node 代理指向 `127.0.0.1:7890` | 除非 `USE_PROXY=true`，启动时清除继承的代理变量并使用直连 Agent。 |
| AI 超时或失败难以排查 | 使用可配置超时，错误返回 JSON、状态、消息与 `requestId`；日志不写入 Key 或照片内容。 |
| 401 / 客户端未初始化 | 使用 `OPENAI_API_KEY` 初始化 OpenAI Compatible Client，健康检查公开是否已配置但不公开密钥。 |
| DashScope 返回内容格式差异 | 服务端兼容字符串和 content parts，去除 Markdown fence 后解析 JSON，并映射字段别名。 |
| Flutter 提示“分析不完整” | Flutter `OutfitAnalysis` 与服务端契约统一为顶层 `bodyProfile`、`style`、对象型 `recommendations` 和数组型 `products`。 |
| 重复请求、重建与内存压力 | AI 生成由页面状态控制为单次执行；图片选择、预览和请求采用大小校验与受控编码，避免在 build 中重复请求。 |

## 当前可复现的验证方式

1. 在 `server/.env` 设置真实 DashScope Key，并保持 `AI_FORCE_MOCK=false`。
2. 启动 `node index.js` 或 `npm.cmd start`。
3. 访问 `/health`，确认 `analysis_mode=live`、`ai_provider=dashscope`、`ai_model=qwen-vl-plus`。
4. 在 Android 模拟器启动 Flutter，选择三张图片并生成穿搭方案。
5. 确认结果包含身体分析、风格、上衣/下装/鞋/配饰建议、总结和推荐商品。

## v1.0 固化信息

- Git 提交：`1539675b1afb4899ff3db0a1c3833a277f7e107c`
- Git 标签：`v1.0-ai-outfit-working`
- 固化前真实 `/outfit` 验证：HTTP 200、`analysisMode=ai`、Flutter 契约字段完整。

