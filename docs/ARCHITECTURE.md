# FitAI Architecture

## Client

Flutter 客户端采用 UI/Data 分层和单向数据流：

```text
AiOutfitPage
  ├─ 负责渲染、输入控制器和系统图片选择
  ├─ ImageDataService：格式、大小和 Data URL 编码
  └─ OutfitViewModel
       └─ OutfitRepository
            └─ AIService
                 └─ Node /outfit
```

- View 不保存网络协议细节。
- ViewModel 是加载、结果和错误状态的唯一来源。
- Repository 隔离远程实现，测试可以注入 Fake。
- Service 接收可注入的 HTTP Client 和 AppConfig。
- API 模型不可变，JSON 键只在模型和 Service 边界处理。

## API contract

请求：

```json
{
  "height": 170,
  "weight": 60,
  "scene": "日常",
  "request": "通勤穿搭",
  "images": {
    "front": "data:image/jpeg;base64,...",
    "side": "data:image/jpeg;base64,...",
    "back": "data:image/jpeg;base64,..."
  }
}
```

成功响应：

```json
{
  "body_analysis": "",
  "style": "",
  "top": "",
  "bottom": "",
  "shoes": "",
  "accessories": "",
  "suggestion": ""
}
```

错误响应：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "可安全展示给用户的信息",
    "request_id": "用于排障的请求编号"
  }
}
```

## Backend controls

- 严格验证数值、文本、图片角色、MIME、Base64 和图片大小
- 单 IP 速率限制和单进程并发限制
- 上游 AI 超时与取消
- Qwen-VL JSON Mode 加服务端字段校验
- CORS allowlist、安全响应头、无缓存和请求 ID
- 日志只记录请求元数据，不记录正文或图片

当前内存限流适合单实例 MVP。多实例生产部署应在 API Gateway 或 Redis 中实现共享限流与并发配额。

## V1.0 product loop

```text
HomePage
  └─ RecommendationEngine
       ├─ UserProfile
       ├─ AI body analysis
       ├─ browsing / favorites
       ├─ RecommendationFeedback
       └─ Mock product + OutfitPost catalogs
            ├─ ranked home content
            ├─ ranked products
            └─ OutfitPlan

AiOutfitPage
  ├─ POST /outfit
  ├─ ProductService
  ├─ UserProfileService
  └─ TryOnRequest
       └─ ModelPage
            ├─ VirtualTryOnRepository
            ├─ local wardrobe history
            ├─ product replacement
            └─ ShareOutfit card
```

### Personalization

- `UserProfile` stores body data, style/color/brand preferences, purchases, and try-on history.
- `RecommendationFeedback` records product clicks, favorites, try-ons, and purchase intent.
- `RecommendationEngine` is the only home recommendation orchestrator. A remote ranking model can replace it without changing page contracts.
- `UserPreferenceService`, `UserProfileService`, and `RecommendationFeedbackService` currently persist locally.

### Commerce boundaries

- `Product` carries SKU, price, stock, size, color, and purchase URL.
- `BrandProductService` reserves catalog, real-time price, inventory, and purchase-link integration.
- V1 uses `MockBrandProductService`; no live store order is created.

### Sharing

`ShareOutfit` renders an `OutfitPlan` into a PNG card. The card can be saved locally or passed to the native share sheet. This is the base contract for a future community post publisher.

## AI Fashion Feed

```text
HomePage
  ├─ DailyContextService (weather / city context)
  ├─ OutfitChallengeService (7-day local retention loop)
  └─ FeedRecommendationService
       └─ RecommendationEngine
            ├─ UserProfile
            ├─ browsing records
            ├─ favorite products
            ├─ try-on history
            └─ RecommendationFeedback
```

`FeedRecommendationService` returns one immutable `FashionFeed` containing the
daily look, weather-aware reason, scenes, hot AI looks, products, and challenge
state. The current weather provider is local Mock data and does not request
location permission. A production weather provider can replace
`DailyContextService` without changing `HomePage`.

## Commercial loop

```text
AI Look impression
  → ProductAnalytics.impression
  → product click / favorite
  → AI try-on
  → brand product page
  → purchase redirect
  → ProductConversionFunnel
  → AnalyticsService dashboard boundary
```

- `FashionProfile` adds preferred styles/brands, budget range, common colors,
  body features, and purchase history to feed ranking.
- `DailyOutfitService` creates one date-and-scene-specific recommendation from
  weather context and the ranked `OutfitPlan`.
- `ProductAnalyticsService` records exposure, click, favorite, try-on, and
  purchase-redirect events.
- `AnalyticsService` exposes DAU, recommendation CTR, product conversion rate,
  and try-on count. The local implementation can be replaced by a warehouse or
  event-stream client.
- `CommunityEngagementService` persists likes, saved looks, comments, and
  followed authors.
- `BrandPage` is the partner-facing catalog and AI recommendation surface.
- `FitAIProPage` and `FitAIProPlan` define membership UX and entitlements
  without enabling payment.

## Commercialization V1

```text
UserFashionProfile
  -> FeedRecommendationService
  -> Daily outfit / hot AI Look / body-fit products / brands / community

ProductCommerceRepository
  -> mock brand catalog
  -> current price + stock + purchase URI
  -> future live brand adapters

ProductEventService
  -> impression
  -> click
  -> favorite
  -> add to try-on
  -> purchase redirect
  -> purchase completed
  -> ConversionFunnel + AnalyticsDashboard
```

- `ProductCommerceRepository` is the commerce boundary. Its Mock
  implementation uses local products and never creates an external order.
- `BrandPartnerService` models catalog integrations, affiliate commission,
  sponsored recommendations, and campaign revenue share.
- `UserFashionProfileService` combines body data, budget, occupation, scene
  needs, favorite brands/colors, and click history without changing `/outfit`.
- `DigitalWardrobeService` owns uploaded clothing and automatic matching.
  `WardrobeRecognitionService` is the replaceable visual-recognition boundary.
- `AnalyticsDashboard` exposes DAU, average page dwell, CTR, try-on rate,
  completed-purchase conversion, and popular product IDs.
- FitAI Pro remains a UI/data contract only. No payment or renewal is enabled.

## V1.0 launch preparation

```text
Guest / local test user
  -> AuthRepository
  -> UserSessionController
  -> UserAccount (avatar + body + style + budget + brands)
  -> FashionProfileService
  -> home and product ranking

ProductCard
  -> favorite
  -> add to wardrobe
  -> add to virtual try-on
  -> mock purchase redirect
  -> ProductEvent / ConversionFunnel

Avatar + TryOnRequest
  -> VirtualTryOnAPI.createTask
  -> queued / generating / success / failed
  -> progress + provider + result
```

- `LocalAuthRepository` exists for closed testing only. It stores a salted
  password digest and a local Mock session; production must use a remote
  identity provider, server-side token rotation, verification, and recovery.
- Account body, style, budget, and brand preferences are merged into the home
  recommendation profile without changing the `/outfit` contract.
- `FashionProfileService.generateAIProfile` combines photo-analysis count,
  product events, favorites, and purchase history into persona labels and
  confidence.
- `FitAIEntitlements` is the UI and permission boundary for Free/Pro. Payment,
  receipt validation, and server-side quota enforcement remain external work.
- `Avatar`, `TryOnRequest`, and `VirtualTryOnTask` are serializable contracts
  for a future asynchronous virtual try-on provider.

## Commercial testing flow

```text
AI body analysis
  -> OutfitPlan (top + bottom + shoes)
  -> ProductDetailPage
  -> favorite / wardrobe / virtual try-on / purchase redirect
  -> ProductEvent + commission attribution
  -> UserProfile favorites and FashionProfile feedback
```

- `Product.purchaseUrl` is the canonical purchase link; `buyUrl` remains a
  backward-compatible alias. `commission` stores the attribution rate.
- `ProductDetailPage` is a navigable commercial surface shared by Home, AI
  Outfit Report, and Brand pages.
- Each product inside `OutfitPlanCard` opens its exact commercial detail.
- `UserProfile` stores photo bindings and favorite product IDs. The generated
  `Outfit` carries the authenticated user ID, body data, photos, and products
  into `TryOnRequest`.

## Privacy, deletion, and operational safety

```text
Photo selection / AI generation
  -> ConsentService
  -> versioned terms + privacy + photo-processing consent
  -> AI workflow

PrivacyCenterPage
  -> UserDataDeletionService
  -> UserProfile photos
  -> account avatar
  -> DigitalWardrobe images
  -> revoke photo-processing consent
  -> PhotoDeletionReport
```

- `VirtualTryOnService` directly exposes `createTask`, `getStatus`, and
  `getResult`; the existing Mock is one replaceable provider implementation.
- `Product.commissionRate` and `purchaseUrl` are canonical commercial fields.
  Legacy `commission` and `buyUrl` getters remain compatible.
- `AppLogger` records structured operational metadata only and redacts keys or
  values related to photos, images, Base64, passwords, tokens, avatars, and
  authorization.
- Flutter framework and platform errors are captured by the global logger.
- Local deletion is implemented. Production still requires server-side and
  third-party AI provider deletion APIs with auditable completion receipts.
