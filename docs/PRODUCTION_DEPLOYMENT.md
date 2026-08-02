# 树皮 Shupi 生产上线指南

更新日期：2026-08-01

## 1. 当前已落地的代码能力

- Android Release 不再使用 Debug 签名；缺少正式签名配置时会明确终止构建。
- Node 生产模式强制要求 AI、CORS、运营密钥、联盟回传密钥和 Supabase 配置。
- 用户账号、会话、衣柜和运营事件写入 Supabase 云数据库。
- 用户正面、侧面、背面和头像可由已登录客户端上传到 Supabase 私有对象存储。
- 账号注销会先删除云端照片和行为事件，再删除账号、会话和衣柜；客户端同时清理本地资料。
- 远程商品源要求 HTTPS 购买链接，并同时传递树皮渠道 ID 和旧版兼容渠道头。
- Flutter 在 `APP_ENV=production` 时校验所有服务地址和联盟渠道 ID。

当前 Supabase 持久化采用两个隔离 JSON 状态行（`auth` 和 `analytics`），适合单 Node 实例的小范围验证。多实例或规模化上线前需要迁移为规范化表、事务和数据库级并发控制。

## 2. 云数据库和对象存储（需要人工操作）

1. 创建生产 Supabase 项目并选择满足合规要求的数据区域。
2. 在 Supabase SQL Editor 执行 `server/supabase_schema.sql`。
3. 确认 `user-photos` Bucket 为 Private，单文件上限 5 MB，只允许 JPEG/PNG。
4. 在服务器密钥管理中配置 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`。
5. 不得把 Service Role Key 写入 Flutter、网页、Git 或 CI 构建产物。
6. 配置数据库自动备份、恢复演练、对象生命周期和删除审计。

## 3. Node 生产环境

复制 `server/.env.example` 到部署平台的 Secret/Environment 配置，不要提交 `.env`。至少配置：

```text
NODE_ENV=production
DASHSCOPE_API_KEY=... 或 OPENAI_API_KEY=...
CORS_ORIGINS=https://app.example.com
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_ANALYTICS_KEY=...
AFFILIATE_POSTBACK_SECRET=...
TRUST_PROXY=true
```

部署后验证：

```powershell
Invoke-RestMethod https://api.example.com/health
```

`user_store`、`analytics_store` 和 `photo_storage` 都应显示 `supabase`。生产入口必须由 HTTPS 反向代理保护，并配置请求体上限、DDoS/WAF、告警、日志脱敏和密钥轮换。

## 4. Flutter 生产配置

复制 `dart_defines.production.example.json` 为未提交的 `dart_defines.production.json`，替换全部示例域名和渠道 ID：

```powershell
C:\Users\W1565\flutter-sdk\bin\flutter.bat build web --release `
  --dart-define-from-file=dart_defines.production.json
```

生产校验会拒绝空地址和非 HTTPS 地址。公开 dart-define 不能包含管理密钥、Service Role Key 或联盟回传密钥。

## 5. Android 正式包（需要人工密钥）

1. 确定永久 application ID；默认值是 `com.shupi.app`，发布后不可随意更换。
2. 由发布负责人离线创建 Upload Keystore，并在密码管理器和离线介质备份。
3. 复制 `android/key.properties.example` 为 `android/key.properties` 并填写真实值。
4. 如需覆盖 application ID，在 `android/gradle.properties` 或 CI Gradle 参数配置 `SHUPI_APPLICATION_ID`。
5. 构建 App Bundle：

```powershell
C:\Users\W1565\flutter-sdk\bin\flutter.bat build appbundle --release `
  --dart-define-from-file=dart_defines.production.json
```

产物位于 `build/app/outputs/bundle/release/app-release.aab`。上传 Google Play 前启用 Play App Signing，完成目标 API、内容分级、数据安全表单和内部测试轨道验证。

## 6. 真实商品接口契约

`PRODUCT_CATALOG_URL` 指向服务端商品聚合接口。客户端请求：

```http
GET /products?affiliateChannelId=CHANNEL&brand=OPTIONAL
X-Shupi-Affiliate-Channel: CHANNEL
```

响应：

```json
{
  "products": [{
    "id": "product-id",
    "sku": "SKU-001",
    "brand": "Brand",
    "name": "Product",
    "category": "外套",
    "imageUrl": "https://cdn.example.com/product.jpg",
    "price": "399",
    "stock": 20,
    "purchaseUrl": "https://partner.example.com/item?aff=CHANNEL",
    "commissionRate": 0.1,
    "aiReason": "适合当前身材、场景和天气"
  }]
}
```

购买链接必须由可信服务端签名并使用 HTTPS。客户端只做跳转与埋点，不生成联盟签名。购买完成由合作方调用 `/affiliate/conversions` 回传，使用 `x-affiliate-secret` 鉴权并保证订单 ID 幂等。

## 7. 隐私与账号注销（仍需人工审核）

- 应用内已有用户协议、隐私说明、本地照片删除和账号注销页面。
- 运营方需补充真实主体、联系方式、服务商清单、存储地区、保存期限、未成年人规则和投诉渠道。
- 法务/隐私负责人需审核文本，并完成 Android/iOS 商店隐私披露。
- 必须实测：注销后旧 Token 失效、账号/衣柜/事件消失、对象存储前缀为空。

## 8. 正式开放前人工门槛

- 购买域名、部署 Node、配置 HTTPS、监控和告警。
- 创建 Supabase 生产项目并执行 SQL、备份及恢复演练。
- 申请 AI 生产额度和内容安全策略。
- 签约并配置真实联盟渠道、商品接口与订单回传。
- 创建 Android/iOS 开发者账号、证书、商店素材和隐私申报。
- 在至少一台低端 Android、一台主流 Android 和两代 iPhone 上完成真机回归。
- 用测试账号跑通注册 → 上传照片 → AI 分析 → 商品 → 购买跳转 → 注销全链路。
