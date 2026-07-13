# FitAI

FitAI 是一个面向 Android 和 iOS 的 AI 智能穿搭平台。用户可以描述出席场合、个人偏好和期望风格，由 AI 生成个性化穿搭建议；还可以上传照片创建虚拟模特，为后续实现服装预览和虚拟试穿提供基础。

项目当前处于第一阶段，重点是建立稳定、可扩展的 Flutter 移动端基础框架。

## 核心功能

- 首页：展示 FitAI 品牌和产品定位
- AI 穿搭：输入场合及风格需求，生成个性化穿搭建议
- 我的虚拟模特：上传照片并创建 AI 模特
- 我的账户：展示和管理用户资料及应用设置

## 项目进度

### 第一阶段：Flutter 基础框架（已完成）

- [x] 创建 Flutter 项目及 Android、iOS 平台工程
- [x] 创建 Material 3 应用主题
- [x] 创建底部导航栏
- [x] 创建首页
- [x] 创建 AI 穿搭页面和需求输入框
- [x] 创建虚拟模特页面和照片上传入口
- [x] 创建账户页面和用户信息卡片
- [x] 添加页面切换组件测试
- [x] 通过 `flutter analyze`
- [x] 通过 `flutter test`

### 环境状态

- Flutter SDK：3.44.6，位于 `C:\Users\W1565\flutter-sdk`
- Dart SDK：3.12.2
- Android/iOS 工程：已生成
- Android SDK：当前电脑尚未安装
- iOS 构建：需要安装了 Xcode 的 macOS

## 下一步开发计划

### 第二阶段：完善核心交互

- [ ] 接入图片选择器，支持相机拍摄和相册上传
- [ ] 增加照片预览、重新选择和删除功能
- [ ] 完善 AI 穿搭需求表单，包括场合、季节、颜色和风格标签
- [ ] 创建穿搭推荐结果页面
- [ ] 增加加载、空状态和错误提示

### 第三阶段：后端与 AI 能力

- [ ] 设计用户、虚拟模特和穿搭方案的数据模型
- [ ] 接入用户注册、登录和会话管理
- [ ] 接入 AI 穿搭推荐接口
- [ ] 接入照片上传及 AI 虚拟模特生成服务
- [ ] 保存和管理历史穿搭方案

### 第四阶段：产品化与发布

- [ ] 完善深色模式、无障碍体验和多屏幕尺寸适配
- [ ] 增加单元测试、组件测试和端到端测试
- [ ] 配置应用图标、启动页和正式应用标识
- [ ] 完成隐私政策、照片授权和账户注销流程
- [ ] 配置 Android/iOS 自动构建和发布流程

## 项目结构

```text
lib/
  main.dart
  app.dart
  pages/
    home_page.dart
    ai_styling_page.dart
    virtual_model_page.dart
    account_page.dart
test/
  widget_test.dart
android/
ios/
```

## 环境准备

1. 安装 Flutter SDK：https://docs.flutter.dev/get-started/install
2. Android：安装 Android Studio、Android SDK，并创建模拟器或连接真机。
3. iOS：在 macOS 上安装最新版 Xcode 和 CocoaPods。
4. 运行 `flutter doctor`，按提示完成环境配置。

## 运行

```powershell
cd C:\Users\W1565\FitAI
C:\Users\W1565\flutter-sdk\bin\flutter.bat pub get
C:\Users\W1565\flutter-sdk\bin\flutter.bat devices
C:\Users\W1565\flutter-sdk\bin\flutter.bat run
```

如果 Flutter 已加入 PATH，也可以直接使用 `flutter run`。Android 可在 Windows、macOS 或 Linux 构建；iOS 只能在 macOS 和 Xcode 环境中构建、签名。

## 检查与测试

```powershell
C:\Users\W1565\flutter-sdk\bin\flutter.bat analyze
C:\Users\W1565\flutter-sdk\bin\flutter.bat test
```

## 开发记录

- 2026-07-12：完成第一阶段 Flutter 基础框架、四个主要页面、底部导航及组件测试。
- 2026-07-12：生成 Android 和 iOS 平台工程，完成静态分析与测试。
- 2026-07-12：补充项目进度、环境状态、项目结构和开发记录。
- 2026-07-12：完善项目介绍，并新增第二至第四阶段开发计划。
- 2026-07-12：初始化 Git 仓库，开始使用版本控制管理项目。

后续每次修改代码时，都应同步更新本文件中的项目进度与开发记录。
