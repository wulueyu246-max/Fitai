# FitAI V1.0 上线检查清单

更新时间：2026-07-30

## 1. 功能检查

- [x] 邮箱注册、登录、会话恢复、退出登录。
- [x] 用户头像、性别、身高、体重、体型、风格、预算和品牌偏好编辑。
- [x] 首页今日推荐、场景推荐、热门 Look、商品与品牌入口。
- [x] 正面、侧面、背面照片上传和结构化 AI 穿搭报告。
- [x] OutfitPlan 绑定上衣、裤子、鞋和商品级购买链接。
- [x] 商品详情、收藏、加入衣橱、立即试穿、立即购买。
- [x] Mock 异步试穿任务状态、换装、重新生成、保存历史和分享。
- [x] Free/Pro 权益结构与订阅演示，不发生真实扣款。
- [x] 运营数据页展示用户、曝光、点击、收藏、试穿和购买漏斗。
- [ ] 接入邮箱验证、忘记密码、账号注销和异常登录风控。
- [ ] 接入真实 AI 试衣供应商并完成结果内容安全审核。

## 2. 用户流程

1. 用户注册并编辑个人画像。
2. 首页根据身体、偏好、预算、场景和天气生成 Daily Outfit Plan。
3. 用户上传三视图照片，获取 AI 穿搭分析和关联商品。
4. 用户查看商品详情，可收藏、加入衣橱或发起虚拟试穿。
5. 试穿页轮询任务状态，成功后可保存和分享。
6. 用户点击购买，进入带渠道 ID 的联盟商品页。
7. FitAI 记录曝光、点击、收藏、试穿、购买跳转；联盟回传后记录成交。

## 3. 商业流程

- [x] Product 包含 SKU、库存、购买链接、渠道 ID 和佣金率。
- [x] 商品源通过 ProductService / BrandProductService 抽象。
- [x] 支持构建时配置远程商品目录与联盟渠道。
- [x] ProductAnalytics 记录六阶段 ConversionEvent。
- [x] 联盟收益页展示预估收益和确认收益入口。
- [ ] 申请并审核淘宝联盟、京东联盟、Shopify 或品牌 API 账号。
- [ ] 用真实商品级深链替换 Mock 链接，并验证归因参数。
- [ ] 建立服务端订单回传、去重、退款冲正和佣金结算任务。
- [ ] 购买完成只能由可信服务端回传，客户端不能直接确认成交。

## 4. 数据与安全

- [x] Node 密码使用 scrypt 哈希，数据库不保存明文密码。
- [x] 客户端持有会话 Token；服务端仅保存 Token 的 SHA-256 哈希。
- [x] 服务端支持持久化用户文件与会话过期。
- [x] 请求日志不打印请求体、密码、Token 或 Base64 图片。
- [x] 已有用户协议、隐私授权和本地照片删除入口。
- [ ] 生产用户数据迁移至 PostgreSQL/MySQL，不使用单机 JSON 文件。
- [ ] Token 迁移至短期 Access Token + 可撤销 Refresh Token。
- [ ] 对注册、登录和管理接口增加独立速率限制与验证码。
- [ ] 头像和身体照片使用私有对象存储、短期签名 URL 和删除任务。
- [ ] 建立加密、备份、恢复演练、数据留存周期和审计日志。
- [ ] 对管理接口配置独立域名、管理员 RBAC 和二次验证。

## 5. 环境配置

Node 生产环境至少配置：

```env
NODE_ENV=production
PORT=3000
AI_BASE_URL=https://your-ai-provider.example/v1
AI_MODEL=your-vision-model
OPENAI_API_KEY=replace-me
CORS_ORIGINS=https://app.fitai.example
USER_STORE_PATH=D:\fitai-data\users.json
ANALYTICS_STORE_PATH=D:\fitai-data\analytics.json
ADMIN_ANALYTICS_KEY=replace-with-a-long-random-secret
AFFILIATE_POSTBACK_SECRET=replace-with-a-different-long-random-secret
```

Flutter Web Release：

```powershell
C:\Users\W1565\flutter-sdk\bin\flutter.bat build web --release `
  --dart-define=API_BASE_URL=https://api.fitai.example `
  --dart-define=AUTH_API_BASE_URL=https://api.fitai.example `
  --dart-define=ANALYTICS_API_BASE_URL=https://api.fitai.example `
  --dart-define=PRODUCT_CATALOG_URL=https://commerce.fitai.example/products `
  --dart-define=AFFILIATE_CHANNEL_ID=fitai-prod-channel
```

公开构建不要传入 `ADMIN_ANALYTICS_KEY`。仅内部受限运营构建可额外设置
`ADMIN_ANALYTICS_KEY` 与 `SHOW_INTERNAL_TOOLS=true`。

## 6. 自动验证

```powershell
cd C:\Users\W1565\FitAI
C:\Users\W1565\flutter-sdk\bin\flutter.bat analyze
C:\Users\W1565\flutter-sdk\bin\flutter.bat test

cd C:\Users\W1565\FitAI\server
npm.cmd test

cd C:\Users\W1565\FitAI
C:\Users\W1565\flutter-sdk\bin\flutter.bat build web --release
```

- [x] `flutter analyze` 输出 `No issues found`（2026-07-31）。
- [x] `flutter test` 75 项全部通过（2026-07-31）。
- [x] `npm test` 14 项全部通过（2026-07-31）。
- [x] Flutter Web Release 构建成功（2026-07-31）。

## 7. 发布步骤

1. 部署 Node 服务、生产数据库、对象存储和 HTTPS 域名。
2. 配置 AI Key、CORS、用户数据持久卷和管理密钥。
3. 接入首个联盟渠道并抽查 20 个商品的价格、库存和深链。
4. 执行自动测试、Web Release 构建和三端真机回归。
5. 邀请 20-50 名种子用户，验证注册到购买跳转全链路。
6. 每日复盘曝光→点击→试穿→购买跳转漏斗及用户反馈。
7. 达到稳定性门槛后灰度扩大；未接订单回传前不宣称真实成交。

## 8. 真实用户测试脚本

1. 注册一个新账号，退出后重新登录，确认画像可恢复。
2. 编辑头像、性别、身体数据、预算、风格和品牌偏好。
3. 检查首页推荐是否受画像、场景、天气和预算影响。
4. 上传三视图照片并生成 AI 穿搭报告。
5. 检查每套方案都有商品、理由、价格和商品级购买入口。
6. 收藏商品并确认其出现在衣橱。
7. 发起试穿，切换商品，等待成功，保存并分享结果。
8. 点击购买并核对最终 URL 的渠道参数、SKU 和落地商品。
9. 在“运营数据”和“联盟收益”核对事件与预估佣金。
10. 在隐私中心删除照片，确认本地素材和头像被清理。
