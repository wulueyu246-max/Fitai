# FitAI V1.3 商业验证上线准备

更新时间：2026-07-31

## 1. 真实用户完整流程

1. 用户首次进入完成隐私授权和基础画像引导。
2. 用户在“我的账户”注册或登录，画像和衣橱通过 Node 会话同步。
3. 从首页推荐进入 AI 穿搭，上传正面、侧面、背面照片。
4. `/outfit` 返回结构化身体分析和风格建议，Flutter 生成绑定商品的 `OutfitPlan`。
5. 用户进入 3D 虚拟试穿，切换商品、生成 Mock 结果、保存、分享或收藏方案。
6. 用户查看商品详情，点击购买后打开带渠道 ID 的联盟商品链接。
7. 联盟或品牌服务端回传成交订单，Node 记录确认转化和佣金。

## 2. 商业事件口径

| 阶段 | 事件 | 当前触发点 |
| --- | --- | --- |
| 注册 | `user_registered` | 注册成功 |
| 上传 | `photo_upload_completed` | 图片完成本地编码并准备提交 AI |
| 方案 | `outfit_generated` | AI 分析成功并开始加载商品方案 |
| 曝光 | `product_impression` | 首页 Feed 或 AI 推荐商品加载完成 |
| 点击 | `product_click` | 打开商品详情前 |
| 收藏 | `product_favorite` | 商品收藏成功 |
| 试穿 | `product_try_on` | 商品加入虚拟模特成功 |
| 购买意向 | `purchase_intent` | 点击“立即购买” |
| 购买跳转 | `product_purchase_redirect` | 外部商品页成功打开 |
| 确认转化 | `product_purchase_completed` | 可信联盟服务端订单回传 |

购买完成事件不能由公开 Flutter 客户端提交。联盟回传接口为：

```http
POST /affiliate/conversions
X-Affiliate-Secret: <AFFILIATE_POSTBACK_SECRET>
Content-Type: application/json
```

```json
{
  "orderId": "ORDER-10001",
  "productId": "product-id",
  "sku": "SKU-10001",
  "brand": "Brand",
  "channelId": "fitai-channel",
  "productPrice": 599,
  "commissionRate": 0.08,
  "attributionId": "optional-click-id"
}
```

接口使用“渠道 ID + 订单号”生成幂等事件 ID，重复回传不会重复计佣。

## 3. 商业测试数据面板

运营面板包含：

- 每日新增及活跃用户
- 照片上传人数和方案生成数
- 商品曝光、点击和点击率
- 收藏、试穿、购买意向、购买跳转
- 预计佣金和已确认佣金
- 不购买原因和推荐满意度

开发/内部测试构建默认显示运营入口。公开 Release 默认隐藏“运营数据”和“联盟收益”，避免向普通用户暴露商业数据。

内部聚合面板构建参数：

```powershell
flutter run -d chrome `
  --dart-define=ANALYTICS_API_BASE_URL=https://api.fitai.example `
  --dart-define=ADMIN_ANALYTICS_KEY=<internal-only-key> `
  --dart-define=SHOW_INTERNAL_TOOLS=true
```

`ADMIN_ANALYTICS_KEY` 不得进入公开 Web/App 构建。公开运营后台仍应迁移到独立管理端，并使用管理员登录、RBAC 和二次验证。

## 4. 生产环境必需配置

```env
NODE_ENV=production
PORT=3000
OPENAI_API_KEY=<secret>
AI_BASE_URL=<provider-url>
AI_MODEL=<vision-model>
CORS_ORIGINS=https://app.fitai.example
TRUST_PROXY=true
USER_STORE_PATH=<persistent-volume>/users.json
ANALYTICS_STORE_PATH=<persistent-volume>/analytics.json
ADMIN_ANALYTICS_KEY=<long-random-secret>
AFFILIATE_POSTBACK_SECRET=<different-long-random-secret>
```

Flutter 公开测试构建必须设置：

- `API_BASE_URL`
- `AUTH_API_BASE_URL`
- `ANALYTICS_API_BASE_URL`
- `PRODUCT_CATALOG_URL`
- `AFFILIATE_CHANNEL_ID`

不要给公开构建设置 `ADMIN_ANALYTICS_KEY` 或 `SHOW_INTERNAL_TOOLS=true`。

## 5. 上线前尚缺文件与外部步骤

### P0：没有这些不能宣称正式上线

- 生产域名、HTTPS 证书和反向代理/网关配置文件。
- Node 部署描述文件，例如 `Dockerfile`、托管平台配置和健康检查策略。
- 生产数据库迁移方案；当前 JSON 文件只适合小规模封闭测试。
- 私有图片对象存储配置、签名 URL、服务端照片删除接口和第三方 AI 删除证明。
- 账号注销、服务端数据删除、邮箱验证、忘记密码和登录风控。
- 首个联盟平台审核通过、真实商品深链、订单回传字段映射及退款冲正规则。
- 经法律审核并部署到正式 URL 的用户协议、隐私政策和儿童/敏感信息规则。
- 线上错误监控、告警、备份、恢复演练和密钥轮换方案。

### P1：可以在首批封闭测试期间完成

- 将单机 JSON 用户和事件迁移到 PostgreSQL/MySQL。
- 把运营数据迁移到独立管理后台，移除客户端管理密钥方案。
- 建立商品价格、库存和失效链接的定时同步。
- 建立真实订单对账、退款扣回和佣金结算报表。
- 接入真实 AI 试穿供应商及内容安全审核。

## 6. 第一批真实用户发布步骤

1. 申请一个真实联盟渠道，选择 20–50 个库存稳定的商品。
2. 部署 Node 到带持久卷的 HTTPS 环境，配置全部生产变量。
3. 配置商品目录和联盟深链，逐个验证 SKU、价格、渠道参数与落地页。
4. 用测试订单验证购买跳转、订单回传幂等和确认佣金。
5. 完成照片删除和账号注销前，只邀请知情的封闭测试用户，并明确数据处理范围。
6. 发布 Web 灰度地址，邀请 20–50 名种子用户执行注册到购买脚本。
7. 每日观察注册率、方案生成率、商品点击率、购买跳转率和预计佣金。
8. 未接通真实订单回传和退款冲正前，只报告“预计佣金”，不报告真实收入。
