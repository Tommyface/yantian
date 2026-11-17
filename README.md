# 砚田 · Android 移动版

遴选写作素材知识库 —— 完整离线内核，数据留在本机。

## 形态

- **完整安卓应用**：手机端可检索、复习、生成卡片，离线可用
- **技术栈**：React 18 + Capacitor 7（Android WebView）+ 纯 TS 内核
- **数据**：md 事实源 + KV 持久化；坚果云 WebDAV 增量同步（App 内配置应用专用密码）
- **逐字校验**：抽取候选必须是原文子串，杜绝改写/编造党媒金句

## 本地开发

```bash
pnpm install
pnpm dev          # 浏览器开发（localStorage 兜底，可完整体验）
pnpm build        # 构建 web 到 dist/
pnpm exec cap sync android
pnpm exec cap open android   # 需本机 Android Studio
```

## 功能链路

1. **采集**：手动导入写拾页格式 md（front matter），存本机；可勾选上传坚果云
2. **抽取**：内置规则抽取器（金句/小标题），逐字校验，非原文片段自动丢弃
3. **入库**：人工确认后生成素材卡片（候选态→确认态）
4. **检索**：中文子串/多词检索，全文覆盖笔记与卡片
5. **复习**：按掌握度排序的闪卡队列，支持 new/reviewing/mastered
6. **同步**：设置页配置坚果云 WebDAV（地址/账号/应用专用密码），上传全部 md

## 编译 APK

推送到 GitHub 后，`.github/workflows/android.yml` 会自动：
- 构建 web → `cap sync android` → `assembleDebug`
- 上传 APK 为 artifact，并发布到 Release `v0.4.0-android`

也可手动触发：`workflow_dispatch`。

## 数据与安全

- 所有数据存于 App 私有目录（Capacitor Filesystem `Directory.Data`），不进公共存储
- WebDAV 密码只在 App 内填写、存本机 KV，不写死在代码里
- 卡片与索引只在本地生成，不同步，从架构上消灭多端冲突
