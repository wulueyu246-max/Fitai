# API 参考

本文件记录当前真实 AI 穿搭主链路的稳定契约。后端根地址由 Flutter 的 `API_BASE_URL` 配置。

## POST /outfit

提交用户基础参数、场景与照片，生成结构化穿搭分析。

### 请求头

```http
Content-Type: application/json
```

### 请求体

```json
{
  "height": 173,
  "weight": 60,
  "scene": "通勤",
  "request": "生成适合日常通勤的简约穿搭",
  "images": {
    "front": "data:image/jpeg;base64,<front-image>",
    "side": "data:image/jpeg;base64,<side-image>",
    "back": "data:image/jpeg;base64,<back-image>"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `height` | number | 是 | 身高，单位 cm；服务端校验范围。 |
| `weight` | number | 是 | 体重，单位 kg；服务端校验范围。 |
| `scene` | string | 是 | 穿衣场景，例如通勤、约会、旅行。 |
| `request` | string | 是 | 用户的补充穿搭诉求。 |
| `images.front` | Data URL string | 是 | 正面全身照。 |
| `images.side` | Data URL string | 否 | 侧面全身照。 |
| `images.back` | Data URL string | 否 | 背面全身照。 |

图片支持 JPEG、PNG、WebP Data URL，受后端 `MAX_IMAGE_BYTES` 限制。不要在日志或文档中保存真实 Base64。

### 成功响应：200

```json
{
  "bodyProfile": "对身材比例的文字分析",
  "style": "推荐风格定位",
  "recommendations": {
    "top": "上衣建议",
    "bottom": "下装建议",
    "shoes": "鞋履建议",
    "accessories": "配饰建议",
    "summary": "整体搭配总结",
    "products": [
      {
        "product_id": "catalog-product-1",
        "title": "结构感短款外套",
        "brand": "Shupi Select",
        "category": "上衣",
        "price": 399,
        "image_url": "https://cdn.example.com/product-1.jpg",
        "detail_url": "https://shop.example.com/product-1",
        "platform": "mock-catalog",
        "commission_rate": 0.08,
        "affiliate_url": "https://shop.example.com/product-1?channel=test",
        "stock_status": "in_stock"
      }
    ]
  },
  "products": [
    {
      "category": "T恤",
      "style": "简约通勤",
      "keyword": "透气白色T恤"
    }
  ],
  "analysisMode": "ai"
}
```

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `bodyProfile` | string | AI 对身材与比例的分析。 |
| `style` | string | AI 推荐的总体风格。 |
| `recommendations` | object | 分部位穿搭建议，以及商品库匹配后的 `products` 数组。 |
| `recommendations.products` | array | 从服务端商品目录匹配出的真实记录，包含品牌、价格、图片和购买链接。 |
| `products` | array | AI 生成的检索条件，只包含 `category`、`style`、`keyword`。 |
| `analysisMode` | string | `ai` 表示真实模型结果；`mock` 表示降级结果。 |

AI 不生成商品名称、价格或购买链接；这些字段只从商品表写入 `recommendations.products`。

## GET /products/recommend

根据筛选条件查询服务端商品目录。

### Query 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `category` | 否 | `T恤`、`裤子`、`鞋`、`外套`，支持常见别名。 |
| `style` | 否 | 风格关键词，例如极简、通勤、运动。 |
| `color` | 否 | 颜色关键词。 |
| `bodyType` | 否 | 身材适配关键词，例如肩窄、小个子。 |

### 响应

```json
{
  "products": [
    {
      "product_id": "coat-001",
      "title": "短款轻型夹克",
      "brand": "Uniqlo",
      "category": "外套",
      "price": 399,
      "image_url": "assets/images/products/tailored_blazer.jpg",
      "detail_url": "https://example.com/shupi/products/coat-001",
      "platform": "mock-catalog",
      "commission_rate": 0.08,
      "affiliate_url": "https://example.com/shupi/products/coat-001?channel=shupi-test",
      "stock_status": "in_stock",
      "pid": "shupi-test",
      "coupon_url": ""
    }
  ]
}
```

## 商品点击统计

商品卡进入详情时继续复用 `POST /analytics/events`，发送
`name: product_click`。服务端会将点击同步写入
`product_click_events`，客户端不直接访问数据库。

点击事件的 `properties` 至少包含：

```json
{
  "productId": "coat-001",
  "platform": "mock-catalog"
}
```

### GET /products/:id/stats

返回指定商品累计的联盟点击次数：

```json
{
  "click_count": 12
}
```

商品来源替换为淘宝联盟、京东联盟或品牌目录后，该接口和 Flutter
点击事件契约保持不变。

## GET /products/search

淘宝联盟搜索服务入口。当前无完整淘宝凭据时由同一个服务边界返回 Mock
目录；配置淘宝凭据后自动返回淘宝联盟映射结果。

```http
GET /products/search?keyword=通勤外套&category=外套&limit=12
```

响应格式仍为 `{ "products": [...] }`，额外返回当前 `provider` 便于服务端排障。
淘宝未返回正式推广链接时，`affiliate_url` 回退为商品 `detail_url` 占位，不改变 Flutter。

### 错误响应

服务端错误始终返回 JSON，并包含可用于排障的 `requestId`。常见 HTTP 状态：

| 状态 | 说明 |
| --- | --- |
| 400 | 参数、图片格式或图片大小不合法。 |
| 429 | 请求频率或并发超过限制。 |
| 502 / 504 | 上游 AI 服务失败或超时；客户端应结束加载并显示错误。 |

示例：

```json
{
  "status": "error",
  "error": "AI_REQUEST_FAILED",
  "message": "AI 服务暂时不可用，请稍后重试。",
  "requestId": "<request-id>"
}
```

## GET /health

用于本地排障与部署探针。响应会说明服务状态、AI 是否配置、当前 provider、模型和分析模式；不会返回 API Key 或图片内容。
