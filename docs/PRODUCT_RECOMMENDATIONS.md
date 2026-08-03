# 商品推荐模块设计

## 目标与边界

AI 只负责生成身材、风格和商品检索条件，不生成品牌、SKU、价格或购买链接。商品服务根据 AI 条件从已存在的商品库中匹配，结果通过 `recommendations.products` 返回。

当前不使用真实淘宝联盟凭据。商品来源通过服务端 `ProductProvider` 隔离，`platform` 标识数据来源，`detail_url` 与 `affiliate_url` 由 Provider 写入。

## ProductRecommendation

| 字段 | 类型 | 数据库列 | 说明 |
| --- | --- | --- | --- |
| `product_id` | string | `product_id` | 商品主键。 |
| `title` | string | `title` | 商品标题。 |
| `brand` | string | `brand` | 品牌。 |
| `category` | string | `category` | T恤、裤子、鞋、外套等分类。 |
| `price` | number | `price` | 当前价格，建议使用 decimal。 |
| `image_url` | string | `image_url` | HTTPS 商品图片。 |
| `detail_url` | string | `detail_url` | 商品详情页链接。 |
| `platform` | string | `platform` | `mock-catalog`、未来联盟或品牌来源。 |
| `commission_rate` | number | `commission_rate` | 佣金比例，范围 0 到 1。 |
| `affiliate_url` | string | `affiliate_url` | 带渠道归因的购买链接。 |
| `stock_status` | string | `stock_status` | `in_stock`、`out_of_stock` 等库存状态。 |
| `pid` | string | `pid` | 联盟推广位 PID；只由服务端配置。 |
| `coupon_url` | string | `coupon_url` | 可选优惠券链接。 |

`color`、`size`、`tags` 和 AI `keyword` 是后端内部匹配元数据，不进入稳定的商品商业对象。

## 数据库设计

建议使用商品表与推荐关联表分离，避免把用户推荐上下文写回商品主数据。

```sql
create table products (
  product_id text primary key,
  title text not null,
  brand text not null,
  category text not null,
  price decimal(12, 2) not null check (price >= 0),
  image_url text not null,
  detail_url text not null,
  platform text not null,
  commission_rate decimal(6, 5) not null default 0,
  affiliate_url text not null,
  pid text not null default '',
  coupon_url text not null default '',
  stock_status text not null default 'in_stock',
  created_at timestamptz not null default now()
);
```

生产环境应由服务端生成购买链接和佣金信息，Flutter 不持有联盟密钥。

## 数据流

```text
qwen-vl-plus
  -> 商品类型与关键词（旧顶层 products）
  -> ProductProvider
     -> MockProductProvider（无淘宝凭据）
     -> TaobaoProductProvider（凭据完整）
  -> ProductRecommendation[]
  -> recommendations.products
  -> Flutter 商品推荐区域
```

`MockProductProvider` 从 20 条内置测试商品中匹配，覆盖 T恤、裤子、鞋和外套。配置完整的 `TAOBAO_APP_KEY`、`TAOBAO_APP_SECRET` 和 `TAOBAO_PID` 后，工厂切换为 `TaobaoProductProvider`。原顶层 `products` 只保留 AI 的 `category/style/keyword` 查询条件，`recommendations.products` 返回 Provider 的统一商品记录。

Flutter 始终消费同一个 JSON 契约，不持有联盟密钥，也不感知具体 Provider。

## Flutter 展示方案

1. `OutfitAnalysis.productRecommendations` 非空时，自动转换为现有 `Product` 并展示图片、品牌、标题、价格和平台。
2. 点击商品先记录详情点击，再优先打开可信 `affiliate_url`，没有联盟链接时回退到 `detail_url`。
3. 数组为空时兼容旧版 Flutter 本地商品服务，不展示 AI 伪造的名称或价格。
4. 商品卡继续使用已有响应式列表，不增加固定高度。

## 商品查询接口

```http
GET /products/recommend?category=外套&style=通勤&color=藏青&bodyType=肩窄
```

四个参数均可选。响应为 `{ "products": [...] }`，每项均来自服务端商品目录。
