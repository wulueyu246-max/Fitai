# FitAI V1.2 商业测试版说明

## 商业闭环

首页推荐 → AI 身材与风格分析 → 带匹配度的商品 Look → 查看商品详情 → 收藏/保存 → Mock 3D 试穿 → CPS 购买跳转 → 转化与佣金统计。

## 用户数据闭环

- 注册、登录、会话恢复和个人资料由 `AuthRepository` 管理。
- 配置远端认证地址后，用户资料写入 Node 用户存储。
- 收藏商品、保存方案、试穿记录和 AI 建议通过 `/user/wardrobe` 双向同步。
- 同步采用“本地先成功、在线再合并”的策略，网络故障不阻断穿搭和试穿。

## 远端配置

Flutter 构建时至少配置：

```powershell
flutter run -d chrome --dart-define=AUTH_API_BASE_URL=http://127.0.0.1:3000 --dart-define=ANALYTICS_API_BASE_URL=http://127.0.0.1:3000
```

真实商品联盟接入时再配置：

```powershell
--dart-define=PRODUCT_CATALOG_URL=https://your-api.example/products
--dart-define=AFFILIATE_CHANNEL_ID=your-channel-id
```

Node 生产测试至少配置 `USER_STORE_PATH`、`ANALYTICS_STORE_PATH`、`CORS_ORIGINS` 和 AI 服务环境变量。运营后台密钥只能保存在服务端，不能写入 Flutter 客户端。

## 3D 试穿边界

当前第三页使用 Mock Canvas 3D 交互框架，支持身材参数、前后视角、拖拽翻转、单品切换和左右滑动换装。`VirtualModel3DService` 已隔离场景创建、身材更新、服装更新和视角更新；接入 Unity、WebGL 或云端 3D 服务时替换该实现，不需要改页面业务流。

## 上线测试限制

- 当前可用于受控商业测试，不应宣称 Mock 试穿代表真实面料或尺码效果。
- CPS 收入以联盟平台订单回传为准，购买跳转只计入潜在佣金。
- 正式公开发布前仍需生产数据库、对象存储、账号注销、服务端照片删除、联盟回调验签和监控告警。
