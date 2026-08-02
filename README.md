# 树皮 Shupi

树皮是一个 Flutter + Node.js 的 AI 穿搭助手。当前上线候选版保留四个用户入口：首页、AI 穿搭、我的衣柜和账户中心。

## 本地启动

Node：

```powershell
cd C:\Users\W1565\FitAI\server
Copy-Item .env.example .env
npm.cmd install
npm.cmd start
```

Flutter Web：

```powershell
cd C:\Users\W1565\FitAI
C:\Users\W1565\flutter-sdk\bin\flutter.bat pub get
C:\Users\W1565\flutter-sdk\bin\flutter.bat run -d chrome `
  --dart-define=API_BASE_URL=http://127.0.0.1:3000 `
  --dart-define=AUTH_API_BASE_URL=http://127.0.0.1:3000 `
  --dart-define=ANALYTICS_API_BASE_URL=http://127.0.0.1:3000
```

Android 模拟器访问本机 Node 时，把地址改为 `http://10.0.2.2:3000`。真机使用电脑的局域网 IP；生产环境必须使用 HTTPS。

Android 模拟器可直接运行（未传 `API_BASE_URL` 时会自动使用 `10.0.2.2`）：

```powershell
cd C:\Users\W1565\FitAI
C:\Users\W1565\flutter-sdk\bin\flutter.bat run -d emulator-5554
```

也可以显式指定本地后台：

```powershell
C:\Users\W1565\flutter-sdk\bin\flutter.bat run -d emulator-5554 `
  --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

## 验证

```powershell
C:\Users\W1565\flutter-sdk\bin\flutter.bat analyze
C:\Users\W1565\flutter-sdk\bin\flutter.bat test
cd server
npm.cmd test
```

生产部署、云数据库、对象存储、正式签名和商品接口见 [生产上线指南](docs/PRODUCTION_DEPLOYMENT.md)。Android 首次正式发布请逐项执行 [Android 正式发布检查清单](docs/ANDROID_RELEASE_CHECKLIST.md)。

## 生产安全边界

- `SUPABASE_SERVICE_ROLE_KEY`、AI 密钥和联盟回传密钥只能保存在 Node 服务端。
- Flutter 生产构建从未提交的 `dart_defines.production.json` 读取公开 API 地址和渠道 ID。
- 用户照片保存在私有对象存储；日志不得写入 Base64 图片、密码或访问令牌。
- 真实价格、库存、订单和售后以品牌或联盟购买页面为准。
