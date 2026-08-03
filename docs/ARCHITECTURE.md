# Shupi 架构

## 已验证的真实 AI 链路

```text
Flutter App
  |
  | 选择三张照片、填写身高/体重/场景
  v
API Service（AIService + AppConfig）
  |
  | POST /outfit，Android 模拟器使用 10.0.2.2:3000
  v
Node Server（Express）
  |
  | 校验请求、限制图片大小、调用 OpenAI Compatible Client
  v
DashScope（qwen-vl-plus）
  |
  | 返回 JSON 文本
  v
Structured JSON Parser
  |
  | bodyProfile / style / recommendations / products
  v
Flutter UI（OutfitAnalysis -> AI 穿搭报告）
```

## 各层职责

| 层 | 主要位置 | 职责 |
| --- | --- | --- |
| Flutter 页面 | `lib/pages/ai_outfit_page.dart` | 收集用户参数与照片，呈现加载、错误和分析结果。 |
| 图片与请求模型 | `lib/services/image_data_service.dart`、`lib/models/outfit_request.dart` | 校验图片并构造 Data URL 请求，不负责网络协议。 |
| API 服务 | `lib/services/ai_service.dart`、`lib/config/app_config.dart` | 发送 JSON、处理超时与错误，解析服务端响应。 |
| Node API | `server/index.js` | 处理 `/outfit`、输入校验、速率限制、请求 ID、AI 调用与降级策略。 |
| AI 适配层 | `server/index.js` | 通过 DashScope OpenAI Compatible 地址调用 `qwen-vl-plus`，并校验模型输出。 |
| 结果模型 | `lib/models/outfit_analysis.dart` | 将顶部 JSON 映射为 Flutter 可展示的 `OutfitAnalysis` 与商品列表。 |

## 配置边界

- Flutter 使用 `API_BASE_URL` 作为后端地址。Android 模拟器会把 `localhost` 或 `127.0.0.1` 自动转换为 `10.0.2.2`。
- Node 从 `server/.env` 读取 `OPENAI_API_KEY`、`AI_BASE_URL`、`AI_MODEL` 与超时设置。
- DashScope Key 只存在于服务端环境变量，不能通过 Flutter `--dart-define` 下发。
- `AI_FORCE_MOCK=false` 且配置 Key 时使用真实 AI；没有 Key 或请求异常时，服务端仍保留受控 Mock 降级能力。

## 质量与安全

- 后端校验身高、体重、场景、文本、图片角色、MIME、Base64 与大小。
- API 有超时、错误 JSON、`requestId` 与脱敏日志；不记录照片 Base64 或密钥。
- 真实 AI 结果在服务端被规范化为固定字段后才返回 Flutter，避免模型文本直接进入 UI。

其他页面、商品、衣柜、试穿与运营模块保留在项目中，但不属于当前 v1.0 真实 AI 穿搭链路的必需依赖。
