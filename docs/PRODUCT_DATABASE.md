# 树皮 Shupi 第一版商品数据库

## 当前实现

第一阶段不连接真实品牌 API。应用启动后由 `MockProductRepository` 将内置的 58 条商品种子装载到内存 Product 表；首页、AI 穿搭、详情页和内部商品管理页共享同一个仓储实例。

商品管理入口默认隐藏。开发构建使用以下参数后，入口会显示在账户中心：

```powershell
flutter run --dart-define=SHOW_INTERNAL_TOOLS=true
```

管理页支持搜索、分类筛选、查看详情和上下架。下架商品仍可供管理员查看，但不会出现在用户商品目录或 AI 推荐中。内存状态在应用重启后恢复为 Mock 种子状态。

## Product 字段

| Flutter / JSON | SQL | 说明 |
|---|---|---|
| `id` | `id` | 商品主键 |
| `brand` | `brand` | 品牌 |
| `name` | `name` | 商品名称 |
| `category` | `category` | 商品分类 |
| `imageUrl` | `image_url` | 商品图片 |
| `price` | `price` | 当前价格 |
| `color` | `color` | 颜色 |
| `size` | `size` | 尺码范围 |
| `material` | `material` | 材质 |
| `season` | `season` | 适用季节 |
| `style` | `style` | 风格 |
| `purchaseUrl` | `purchase_url` | 联盟/品牌购买地址 |
| `isAvailable` | `is_available` | 是否允许展示、推荐和购买 |

现有商业链路继续保留 SKU、库存、佣金率、联盟渠道、AI 推荐理由和试穿能力等扩展字段。

## 数据流

```text
MockProductDatabase（58条种子）
          ↓
MockProductRepository（Product表边界）
          ↓
BrandProductService / ProductService
          ↓
RecommendationService（只读取 isAvailable=true）
          ↓
AI穿搭商品、首页商品、详情页、试穿
```

视觉模型只返回身体与风格分析。`OutfitViewModel` 会丢弃 AI 响应中可能携带的商品或 Look，随后由 `ProductService` 从 ProductRepository 读取真实存在的商品并组装推荐，防止模型生成不存在的商品。

## 未来联盟接入

- `AllianceProductAdapter`：京东联盟、淘宝联盟适配器统一分页接口。
- `ProductCatalogSyncService`：把联盟商品标准化后写入 `ProductRepository`。
- `BrandProductService`：为首页和商品详情提供统一读取接口。
- `RemoteBrandProductService`：消费树皮服务端的商品聚合 API，客户端不保存联盟签名密钥。
- `server/supabase_schema.sql`：已包含生产 `products` 表与索引；第一阶段暂不执行自动同步。

未来只需实现 `AllianceProductAdapter` 和云端 `ProductRepository`，AI 页面与商品 UI 无需改写。
