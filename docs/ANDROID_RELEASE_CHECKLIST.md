# 树皮 Shupi Android 正式发布检查清单

更新日期：2026-08-01  
目标版本：`1.5.0+5`  
预期 application ID：`com.shupi.app`  
预期产物：`build/app/outputs/bundle/release/app-release.aab`

> 本文只覆盖发布收口，不新增产品功能。标记为 **阻塞** 的项目完成前，不得提交 Production。

## 0. 当前发布状态

| 项目 | 当前状态 | 结论 |
|---|---|---|
| 应用名称 | `树皮 Shupi` | 已配置 |
| Flutter 版本号 | `1.5.0+5` | 首次上传可用；以后每次上传必须增加 `+versionCode` |
| application ID | Gradle 默认 `com.shupi.app` | 发布负责人必须最终确认；首次发布后不要更换 |
| namespace | `com.fitai.fit_ai` | 可与 application ID 不同，不阻塞发布 |
| compileSdk / targetSdk | Flutter SDK 默认 API 36 | 符合 2026-08-31 起新应用要求 |
| minSdk | API 24 | 已配置 |
| Java / JVM | 17 | 已配置 |
| Release 签名门禁 | 缺少正式签名时构建直接失败 | 已配置 |
| Android SDK | 本机未安装或未被发现 | **阻塞** |
| Upload Keystore | 未创建 | **阻塞** |
| `android/key.properties` | 不存在 | **阻塞** |
| `dart_defines.production.json` | 不存在 | **阻塞** |
| 真实生产 API/商品地址 | 示例值仍是 `example.com` | **阻塞** |
| Android 启动图标 | 仍是 Flutter 默认图标 | **阻塞**，发布前替换为树皮图标 |
| AAB | 尚未生成 | **阻塞** |
| Web 隐私政策 URL | 尚未提供公开地址 | **阻塞** |
| Web 账号删除 URL | 尚未提供公开地址 | **阻塞** |
| Google Play 开发者账号 | 需人工确认及完成身份验证 | **阻塞** |

Google Play 已公告：从 2026-08-31 起，手机和平板的新应用与更新必须以 Android 16 / API 36 为目标。当前项目通过 Flutter 的 `targetSdkVersion` 使用 API 36，安装 SDK Platform 36 后即可满足该项。[官方目标 API 要求](https://support.google.com/googleplay/android-developer/answer/11926878)

---

## 1. Android 发布总检查清单

### 1.1 身份与产品信息

- [ ] Google Play 开发者账号已注册并完成个人/组织身份验证。
- [ ] 已启用两步验证；至少设置一名备用管理员。
- [ ] 最终确认应用名称：`树皮 Shupi`。
- [ ] 最终确认 application ID：`com.shupi.app`。
- [ ] 已确认该 package name 未在其他 Play Console 应用中占用。
- [ ] 已确认运营主体名称、客服邮箱、隐私联系人和办公地址。
- [ ] 已确认免费应用/付费应用选择。首次发布后，免费应用不能直接改为付费应用。
- [ ] 已确定首发国家和地区。

### 1.2 构建环境

- [ ] 安装最新稳定版 Android Studio。
- [ ] 安装 Android SDK Platform 36。
- [ ] 安装 Android SDK Build-Tools、Platform-Tools、Command-line Tools。
- [ ] `android/local.properties` 包含正确的 `sdk.dir` 和 `flutter.sdk`。
- [ ] `flutter doctor -v` 中 Android toolchain 无错误。
- [ ] 完成 `flutter doctor --android-licenses`。
- [ ] 至少创建一个 API 36 模拟器，或连接 API 级别接近的真机。

### 1.3 品牌与资源

- [ ] 替换所有 `mipmap-*` 下的 Flutter 默认 `ic_launcher.png`。
- [ ] 配置 Android Adaptive Icon，检查圆形、方形和圆角裁切。
- [ ] 启动页、应用图标、应用内名称均为“树皮 Shupi”。
- [ ] 准备 Play 商店 512×512 PNG 图标，最大 1024 KB。
- [ ] 准备 1024×500 JPEG/无 Alpha PNG Feature Graphic。
- [ ] 准备真实手机截图；不得展示尚未开放的 3D、会员或支付功能。
- [ ] 商店描述只宣传当前可用能力，不使用“100%准确”等无法证明的表述。

Google Play 的商店资源规格以官方页面为准：[预览资源要求](https://support.google.com/googleplay/android-developer/answer/9866151)

### 1.4 生产配置

- [ ] 从 `dart_defines.production.example.json` 创建未提交的 `dart_defines.production.json`。
- [ ] `APP_ENV` 为 `production`。
- [ ] `API_BASE_URL` 是可访问的真实 HTTPS 地址。
- [ ] `AUTH_API_BASE_URL` 是可访问的真实 HTTPS 地址。
- [ ] `ANALYTICS_API_BASE_URL` 是可访问的真实 HTTPS 地址。
- [ ] `PRODUCT_CATALOG_URL` 是可访问的真实 HTTPS 商品接口。
- [ ] `AFFILIATE_CHANNEL_ID` 已替换为真实渠道 ID。
- [ ] Node 生产环境已配置 Supabase、AI、CORS、运营和联盟回传密钥。
- [ ] `/health` 返回 `user_store= supabase`、`analytics_store= supabase`、`photo_storage= supabase`。
- [ ] 生产 CORS 包含正式 Web Origin，但不使用 `*`。
- [ ] Flutter 构建参数中不存在 Supabase Service Role、AI Key、管理员密钥或联盟回传密钥。

### 1.5 签名与产物

- [ ] 创建独立 Upload Keystore，RSA 至少 2048 位。
- [ ] Keystore 不在 Git 仓库内，且有加密离线备份。
- [ ] 密码保存在密码管理器/CI Secret，不通过微信、邮件或代码传递。
- [ ] 创建未提交的 `android/key.properties`。
- [ ] Release 构建使用 `release` signingConfig，而不是 `debug`。
- [ ] 成功生成 `app-release.aab`。
- [ ] 校验 AAB 已签名且版本为 `1.5.0 (5)`。
- [ ] 保存该次源码 commit、构建参数、AAB SHA-256 和发布说明。
- [ ] 上传 Play Console 后启用 Play App Signing，区分 Upload Key 与 App Signing Key。

Google 建议 Upload Key 和 App Signing Key 分离；新应用上传 AAB 时默认加入 Play App Signing。[Play App Signing 官方说明](https://support.google.com/googleplay/android-developer/answer/9842756)

---

## 2. 当前项目需要人工配置的位置

| 文件/平台 | 人工配置内容 | 是否提交 Git |
|---|---|---|
| `android/local.properties` | 增加本机 Android SDK 路径 | 否 |
| `android/key.properties` | Keystore 路径、alias、两个密码 | 否 |
| Upload Keystore `.jks` | 正式上传私钥 | 绝对不能提交 |
| `android/gradle.properties` 或 CI Gradle 参数 | 如需覆盖，设置最终 `SHUPI_APPLICATION_ID` | 可提交无密钥配置 |
| `dart_defines.production.json` | 真实 HTTPS API、商品地址和渠道 ID | 否 |
| `server/.env`/部署平台 Secret | AI、Supabase、管理员、联盟回传密钥 | 否 |
| `android/app/src/main/res/mipmap-*` | 替换默认 Flutter 图标 | 是 |
| Android Adaptive Icon 资源 | 前景层、背景色/背景层 | 是 |
| Play Console | 开发者身份、应用条目、商店素材、内容声明、测试轨道 | 平台配置 |
| 公开网站 | 隐私政策 URL、账号删除 URL、客服页面 | 网站部署 |
| Supabase | 执行 schema、备份、区域、私有 Bucket、密钥轮换 | 平台配置 |
| 商品联盟平台 | 真实渠道 ID、购买链接、订单回传 Secret | 平台配置 |

### `android/local.properties` 示例

Windows 路径可使用双反斜杠：

```properties
sdk.dir=C:\\Users\\W1565\\AppData\\Local\\Android\\Sdk
flutter.sdk=C:\\Users\\W1565\\flutter-sdk
```

### `dart_defines.production.json` 必填示例

```json
{
  "APP_ENV": "production",
  "API_BASE_URL": "https://api.your-domain.com",
  "AUTH_API_BASE_URL": "https://api.your-domain.com",
  "ANALYTICS_API_BASE_URL": "https://api.your-domain.com",
  "PRODUCT_CATALOG_URL": "https://commerce.your-domain.com/products",
  "AFFILIATE_CHANNEL_ID": "your-real-channel-id",
  "AI_TIMEOUT_MS": "90000",
  "MAX_IMAGE_BYTES": "5242880"
}
```

---

## 3. Android Studio 配置步骤（Windows）

1. 从 [Android Studio 官方页面](https://developer.android.com/studio/install) 下载最新稳定版 EXE。
2. 运行安装程序，勾选 Android Studio、Android SDK、Android Virtual Device。
3. 首次启动进入 Setup Wizard，选择 Standard 并安装推荐组件。
4. 打开 `More Actions > SDK Manager`：
   - `SDK Platforms`：勾选 Android 16 / API 36。
   - `SDK Tools`：勾选 Android SDK Build-Tools、Android SDK Platform-Tools、Android SDK Command-line Tools (latest)。
   - 如使用模拟器，再安装 Android Emulator 和对应系统镜像。
5. 在 Android Studio 插件页安装 Flutter 插件；Dart 插件会随之安装。
6. 用 Android Studio 打开 `C:\Users\W1565\FitAI`，等待 Gradle Sync 完成。
7. 确认 `android/local.properties` 出现正确的 `sdk.dir`。
8. 打开 PowerShell 执行：

```powershell
cd C:\Users\W1565\FitAI
C:\Users\W1565\flutter-sdk\bin\flutter.bat doctor -v
C:\Users\W1565\flutter-sdk\bin\flutter.bat doctor --android-licenses
C:\Users\W1565\flutter-sdk\bin\flutter.bat devices
```

9. 在 `Device Manager` 创建 API 36 模拟器，建议至少测试普通手机和小屏手机。
10. 连接真机时开启开发者选项和 USB 调试，执行 `adb devices` 确认设备状态为 `device`。

Android 官方建议通过 Setup Wizard 安装推荐 SDK 组件，并使用模拟器覆盖不同配置。[Android Studio 安装说明](https://developer.android.com/studio/install)

---

## 4. 签名文件配置步骤

### 4.1 创建 Upload Keystore

推荐在项目目录之外创建，例如：

```text
C:\Users\W1565\ShupiKeys\shupi-upload.jks
```

可使用 Android Studio：

1. `Build > Generate Signed Bundle / APK`。
2. 选择 `Android App Bundle`。
3. 选择 `Create new...`。
4. Key store path 选择项目外目录。
5. Alias 使用 `upload`。
6. 使用强随机密码，Validity 建议至少 25 年。
7. 姓名/组织信息填写真实发布主体。

也可使用 JDK `keytool`，密码会交互输入，不要写在命令行：

```powershell
keytool -genkeypair -v `
  -keystore C:\Users\W1565\ShupiKeys\shupi-upload.jks `
  -alias upload `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

### 4.2 配置项目

复制示例：

```powershell
Copy-Item android\key.properties.example android\key.properties
```

编辑 `android/key.properties`：

```properties
storePassword=从密码管理器填写
keyPassword=从密码管理器填写
keyAlias=upload
storeFile=C:/Users/W1565/ShupiKeys/shupi-upload.jks
```

检查：

- [ ] `android/key.properties` 被 `.gitignore` 忽略。
- [ ] `.jks` 被 `.gitignore` 忽略且位于项目外。
- [ ] Keystore、alias、密码在另一台受控电脑上可恢复。
- [ ] 备份 Keystore 后记录 SHA-256，不把私钥上传到普通网盘。

### 4.3 构建正式 AAB

```powershell
cd C:\Users\W1565\FitAI
C:\Users\W1565\flutter-sdk\bin\flutter.bat clean
C:\Users\W1565\flutter-sdk\bin\flutter.bat pub get
C:\Users\W1565\flutter-sdk\bin\flutter.bat analyze
C:\Users\W1565\flutter-sdk\bin\flutter.bat test
C:\Users\W1565\flutter-sdk\bin\flutter.bat build appbundle --release `
  --dart-define-from-file=dart_defines.production.json
```

预期产物：

```text
C:\Users\W1565\FitAI\build\app\outputs\bundle\release\app-release.aab
```

校验签名与摘要：

```powershell
jarsigner -verify -verbose -certs build\app\outputs\bundle\release\app-release.aab
Get-FileHash build\app\outputs\bundle\release\app-release.aab -Algorithm SHA256
```

Flutter 官方 Android 发布流程可作为构建命令的最终依据：[Build and release an Android app](https://docs.flutter.dev/deployment/android)

---

## 5. Google Play 上传步骤

### 5.1 创建应用

1. 登录 Play Console，完成开发者身份验证与付款资料。
2. 点击 `Create app`。
3. 应用名称填写“树皮 Shupi”，默认语言选择实际商店文案语言。
4. 选择 App、免费/付费并接受声明。
5. 上传前再次确认 package name 是 `com.shupi.app`。Package name 具有唯一性和长期性，不要先用测试名称占位。[创建应用官方说明](https://support.google.com/googleplay/android-developer/answer/9859152)

### 5.2 完成商店资料

- [ ] 应用名称不超过 30 字符。
- [ ] 短描述不超过 80 字符。
- [ ] 完整描述不超过 4000 字符。
- [ ] 上传 512×512 图标、1024×500 Feature Graphic 和真实手机截图。
- [ ] 填写分类、标签、客服邮箱、网站和隐私政策 URL。
- [ ] 描述联盟商品跳转关系，不把树皮描述为商品实际销售方。

### 5.3 完成 App content

- [ ] Privacy policy：填写公开、无需登录、HTTPS 的隐私政策地址。
- [ ] Data safety：按真实行为申报账号信息、用户照片、身体资料、位置、操作/分析事件及第三方 AI 处理。
- [ ] Account deletion：填写公开网页删除入口。
- [ ] Ads：根据真实商业展示模式如实选择；联盟商品不应被错误隐藏。
- [ ] App access：若审核功能需要登录，提供长期有效的审核测试账号和步骤。
- [ ] Target audience：选择真实目标年龄，不把未成年人作为默认测试群体。
- [ ] Content rating：完成问卷，避免应用处于 Unrated。
- [ ] Permissions：核对 INTERNET、CAMERA、COARSE/FINE LOCATION 与隐私文本一致。

Google Play 要求所有发布轨道完成 Data safety；只要应用支持创建账号，就同时需要应用内删除入口和可公开访问的网页删除入口。项目已有应用内注销，但网页入口仍需人工部署。[Data safety 官方说明](https://support.google.com/googleplay/android-developer/answer/10787469) · [账号删除要求](https://support.google.com/googleplay/android-developer/answer/13327111)

### 5.4 上传与测试

1. 进入 `Test and release > Internal testing`。
2. 创建 release，首次上传 `app-release.aab`。
3. 接受 Play App Signing，推荐由 Google 生成 App Signing Key，自己只保存 Upload Key。
4. 填写 Release notes，例如：`树皮 Shupi 1.5.0 首次测试版本`。
5. 添加内部测试人员并发布内部测试。
6. 查看 Pre-launch report、App bundle explorer、Android vitals 和 Policy status。
7. 在 Play 提供的安装包上完成真机全流程，不只测试本地 `flutter run`。
8. 若是 2023-11-13 之后创建的个人开发者账号，执行 Closed testing：至少 12 名测试者连续加入 14 天，然后申请 Production access。[官方测试要求](https://support.google.com/googleplay/android-developer/answer/14151465)
9. 通过测试与政策检查后，进入 `Production > Create new release`，选择已验证的 AAB。
10. 检查国家/地区、版本、声明、Release notes，提交审核。首次上线建议开启 Managed publishing，审核通过后再人工发布。

---

## 6. 上线前最终测试清单

### 6.1 自动化与构建

- [ ] `flutter analyze`：`No issues found`。
- [ ] `flutter test`：全部通过。
- [ ] `npm test`：全部通过。
- [ ] `flutter build appbundle --release`：成功。
- [ ] AAB 签名校验通过。
- [ ] Play Console 未提示 target API、64 位、签名、版本码或大小错误。
- [ ] Pre-launch report 无阻塞崩溃、ANR、严重无障碍或安全问题。

### 6.2 真实生产全链路

- [ ] 全新安装，首次引导可以完成。
- [ ] 拒绝定位后可以手动选择城市。
- [ ] 允许定位后城市、实时天气和推荐正确更新。
- [ ] 邮箱注册、登录、退出、会话恢复正常。
- [ ] 手机号登录入口如未接生产短信，必须保持不可用或明确提示，不能返回调试验证码。
- [ ] 相机拍摄、相册选择、正/侧/背照片上传成功。
- [ ] 超大、损坏或非图片文件得到可理解的错误提示。
- [ ] AI 分析在弱网、超时、服务器 4xx/5xx 下有加载状态和错误恢复。
- [ ] AI 结果、商品图片、商品理由、价格和库存完整展示，无 Overflow。
- [ ] 商品详情中的购买链接为真实 HTTPS 联盟链接。
- [ ] 点击购买产生 `product_click`、`purchase_intent`、`product_purchase_redirect` 事件。
- [ ] 联盟订单回传幂等，预计佣金和确认佣金口径一致。
- [ ] 收藏、衣柜、试穿历史在重新登录后可恢复。
- [ ] 账号注销后旧 Token 返回 401，账号、衣柜、事件和对象存储照片已删除。
- [ ] 隐私政策、用户协议和网页删除入口无需登录即可打开。

### 6.3 设备与交互矩阵

- [ ] 小屏 Android 手机：导航、键盘、上传和结果页无遮挡。
- [ ] 主流 Android 设备：相机、相册、定位、分享和外链跳转正常。
- [ ] API 24 最低版本设备/模拟器完成冒烟测试。
- [ ] API 36 设备/模拟器完成权限和边到边布局测试。
- [ ] 深色模式下即使应用固定浅色主题，系统栏文字仍清晰。
- [ ] 字体放大 1.3 倍无核心内容截断。
- [ ] 中文、英文系统语言下应用不会崩溃。
- [ ] Wi-Fi、移动网络、断网和网络切换均测试。
- [ ] 返回键、后台恢复、旋转限制和进程重建行为可接受。

### 6.4 安全与隐私

- [ ] AAB 中搜索不到 AI Key、Supabase Service Role Key、管理密钥和联盟回传 Secret。
- [ ] API 全部使用 HTTPS，证书链有效且未过期。
- [ ] 日志不包含 Base64 图片、密码、Token、验证码或完整请求体。
- [ ] Supabase `user-photos` Bucket 为 Private。
- [ ] 数据库备份和恢复演练完成。
- [ ] 生产密钥支持轮换，至少两名负责人知道应急流程。
- [ ] 隐私政策与 Play Data safety 的数据类型、第三方服务商和删除方式完全一致。
- [ ] 审核测试账号不使用真实用户照片和个人数据。

### 6.5 发布 Go / No-Go

只有以下条件全部成立才可选择 **Go**：

- [ ] Android SDK、正式 Upload Key、生产配置全部就绪。
- [ ] AAB 已生成、签名验证并上传内部测试。
- [ ] 真实生产全链路通过，而非 Mock 数据通过。
- [ ] 无 P0/P1 崩溃、数据泄露、账号删除或购买追踪问题。
- [ ] Play Console 所有 App content 与政策任务均为完成状态。
- [ ] 隐私政策和账号删除网页已公开可访问。
- [ ] 法务/隐私、技术、产品三方完成发布确认。
- [ ] 已保存可回滚的上一版本、数据库备份和发布记录。

当前结论：**No-Go**。需要先安装 Android SDK、替换默认 Flutter 图标、创建 Upload Keystore、填写真实生产配置、部署隐私/账号删除网页并生成 AAB。完成后按本文顺序执行，即可得到第一个可提交 Google Play 的正式版本。
