# FitAI V1.1 用户验证说明

## 首次用户路径

1. 三页引导解释 FitAI、比例推荐与照片收益。
2. 用户选择日常、工作、约会、聚会或旅行。
3. App 直接进入对应场景的 AI 穿搭页。
4. 用户上传照片并生成第一套 OutfitPlan。
5. 用户可查看商品解释、分享卡片并提交推荐反馈。

## FeedbackEvent

每次反馈记录：

- 1-5 分推荐满意度
- 是否喜欢搭配
- 是否愿意购买
- 不购买原因
- 场景、用户和 OutfitPlan

运营页汇总今日反馈数、平均满意度、购买意愿率和不购买原因。

## 每日指标定义

- 新增用户：完成首次引导或完成注册的去重用户。
- 上传照片人数：当天成功编码并提交照片的去重用户。
- 生成次数：当天成功生成 AI 穿搭报告的次数。
- 商品点击率：商品点击数 / 商品曝光数。
- 收藏率：商品收藏数 / 商品点击数。
- 购买跳转率：购买跳转数 / 商品点击数。

客户端始终保留本地指标。构建时设置
`ANALYTICS_API_BASE_URL` 后，脱敏事件会同步到 Node：

```powershell
--dart-define=ANALYTICS_API_BASE_URL=https://api.fitai.example
```

Node 使用 `ANALYTICS_STORE_PATH` 持久化事件；管理端通过带
`X-Admin-Key` 的 `GET /admin/analytics` 获取每日汇总。
