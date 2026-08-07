# 树皮 Shupi（FitAI）

树皮 Shupi 是一个 Flutter + Node.js 的 AI 穿搭推荐项目。用户上传正面、侧面和背面照片，填写身高、体重与场景后，应用会调用 DashScope 的 `qwen3.7-plus` 生成结构化穿搭分析，并在 Flutter 中展示身体分析、风格、搭配建议和推荐商品。

当前已验证的主链路：

```text
Flutter App -> 图片上传 -> POST /outfit -> Node Server
-> DashScope qwen3.7-plus -> 结构化 JSON -> Flutter 穿搭报告
```

## 目录

```text
lib/                 Flutter 应用、模型、服务与页面
server/              Node.js API 与 AI 适配层
assets/              内置展示图与商品图
test/                Flutter 测试
server/test/         Node 测试
docs/                开发记录、架构、API 与规划文档
```

详细文档入口见 [docs/README.md](docs/README.md)。

## 本地运行

### 1. 启动 Node 后端

```powershell
cd C:\Users\W1565\FitAI\server
Copy-Item .env.example .env
npm.cmd install
npm.cmd start
```

在 `server/.env` 中配置 DashScope。真实密钥只保存在这个本地文件中，不能提交：

```env
OPENAI_API_KEY=<DashScope API Key>
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen3.7-plus
AI_FORCE_MOCK=false
USE_PROXY=false
```

健康检查：

```powershell
Invoke-RestMethod http://localhost:3000/health
```

### 2. 启动 Flutter

Android 模拟器会自动将本机回环地址适配为 `10.0.2.2`：

```powershell
cd C:\Users\W1565\FitAI
C:\Users\W1565\flutter-sdk\bin\flutter.bat pub get
C:\Users\W1565\flutter-sdk\bin\flutter.bat run -d emulator-5554 `
  --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

Web 本地运行：

```powershell
C:\Users\W1565\flutter-sdk\bin\flutter.bat run -d chrome `
  --dart-define=API_BASE_URL=http://127.0.0.1:3000
```

真机调试时，将 `API_BASE_URL` 指向电脑的局域网 IP 和端口 3000；生产环境必须使用 HTTPS。

## 验证

```powershell
C:\Users\W1565\flutter-sdk\bin\flutter.bat analyze
C:\Users\W1565\flutter-sdk\bin\flutter.bat test

cd C:\Users\W1565\FitAI\server
npm.cmd test
```

## 安全边界

- `server/.env`、`android/key.properties`、`*.jks`、构建目录与依赖目录均已忽略。
- 不要将 API Key、签名密码、用户照片 Base64 或完整请求体写入源码、测试、文档或日志。
- 后端日志只应记录脱敏的请求元数据与 `requestId`。
