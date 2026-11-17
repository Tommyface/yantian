# 砚田 Web 前端（React + Vite）

按砚田界面设计方案 v2.2 高保真落地的前端应用，桌面三栏工作台 + 移动端单列布局，对接 yantian 本地服务的 18 个 REST API。

## 快速启动

```bash
# 1) 先启动后端（在 ../yantian）
cd ../yantian && pnpm start /path/to/vault 8765

# 2) 启动前端（另开终端）
cd yantian-web
pnpm install
pnpm dev          # http://127.0.0.1:5173，Vite 自动代理 /api → 8765
```

> 后端未启动时前端会以**演示数据**渲染完整界面（离线可用），启动后端后自动切换为真实数据。

## 构建与部署

```bash
pnpm build        # tsc 类型检查 + vite 构建，产物在 dist/（约 232K）
pnpm preview      # 本地预览生产构建
```

`dist/` 为纯静态文件，可部署到任意静态托管。若脱离本地后端单独部署，需设置 `VITE_API_BASE` 指向可访问的 API 地址；否则显示演示数据。

## 技术栈

| 项 | 选择 |
|---|---|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（base: `./`，相对路径，便于静态部署） |
| 样式 | 设计令牌 CSS（移植自 v2.2 设计稿）+ 响应式外壳，无 UI 库 |
| 数据 | fetch 对接 REST API，演示数据兜底 |
| 图标 | 内联 SVG（无图标库依赖） |

## 目录结构

```
src/
  main.tsx / App.tsx        # 入口、应用骨架（侧边栏/顶栏/底部导航/Toast）
  types.ts                  # 后端数据契约的前端类型
  api.ts                    # 18 个 REST API 封装
  data.tsx                  # 全局数据与演示兜底（DataProvider/useData）
  components/Icon.tsx       # SVG 图标集 + 导航配置
  screens/
    Home.tsx                # 今日：Hero 倒计时、统计卡、趋势图、最近入库
    Library.tsx             # 素材库：搜索、筛选、主题树、素材卡、详情
    Write.tsx               # 写作台：主题素材包、勾选、编辑器、复制引用
    Capture.tsx             # 采集：原文笔记、AI 候选确认、手动导入、导入导出
    Review.tsx              # 复习：翻卡、掌握度三档、进度
  styles/
    design.css              # 设计令牌与组件样式（从设计稿提取）
    app.css                 # 响应式外壳、交互态、移动端适配
preview/                    # 桌面 5 屏 + 移动 5 屏运行截图
```

## 设计说明

- **视觉**：藏青墨蓝主色 + 温润暖金高光，宋体衬线标题，4px 栅格，克制分层阴影。
- **桌面**（>820px）：左侧导航 + 顶栏 + 内容区，素材库/写作台/采集为三栏或双栏布局。
- **移动**（≤820px）：隐藏侧栏，顶部应用栏 + 底部 5 标签栏，内容单列流式，触摸目标 ≥44px，横滑筛选，安全区适配。
- **无障碍**：焦点可见环，语义色配合文字/图标，正文对比度达 WCAG AA。
