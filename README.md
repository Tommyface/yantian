# 砚田 · 遴选写作素材知识库（P0 + P1 + P2 ✅ 全阶段完成）

**P0（数据契约）+ P1（扫描/检索/导入导出）+ P2（本地服务/AI 抽取/Web 界面）全部完成**，
76 个测试全绿、类型检查无错误。一条完整链路已打通：拾页原文 → 扫描入库 → AI 抽取候选 →
人工确认 → FTS5 检索 → 主题素材包 → 写作台调取 → 复习内化 → 导出备份。

## 快速启动

```bash
cd /workspace/yantian
pnpm install
pnpm start              # 默认 vault=./vault，端口 8765
# 或指定：pnpm start /path/to/vault 9000
```
浏览器打开 `http://127.0.0.1:8765`（只监听本机，数据不出电脑）。

## 技术决策（已确认）

| 项 | 选择 | 理由 |
|---|---|---|
| Q1 技术栈 | Node.js + TypeScript（Web 前端后续） | 需读取拾页本地文件 + 跑 FTS5，浏览器沙箱做不到；仍为 JS 栈 |
| Q2 AI 抽取 | 本地模型为主，保留 API 接口 | 默认本地，接口预留（P2 实现） |
| Q3 库位置 | 手机/电脑同一目录 | 单一共享库 |
| Q4 检索 | SQLite FTS5（better-sqlite3 **11.10.0**） | 比 whoosh 稳、中文 trigram 子串匹配；版本已锁定（13.x 预编译在本环境段错误） |
| Q5 起点 | 已完成 P0 → P1 | 逐层验证推进 |

## 目录结构

```
src/
  contracts/                # P0 数据契约
    shared-note.ts          # 共享笔记契约（对齐拾页 front matter）
    material-card.ts        # 素材卡片 Schema + 状态机
  p0/                       # P0 解析与存储
    parse-shared-note.ts    # 拾页 .md 解析器 + 标签映射
    material-card.ts        # 卡片校验 + JSONL 存储
  p1/                       # P1 扫描 / 检索 / 导入导出
    vault-scanner.ts        # 共享库递归扫描 + 增量入库（只读原文）
    search-index.ts         # SQLite FTS5 trigram 索引 + 多维检索
    export-import.ts        # 导出包 / 导入 / 手动导入通道
  p2/                       # P2 应用状态 / AI / 复习 / 服务
    app-state.ts            # 统一状态层（vault + jsonl + 索引 + 扫描协调）
    extractor.ts            # 可插拔抽取器（本地规则 + Ollama/API 预留）
    review.ts               # 主题素材包 + 复习卡 + 引用文本
    server.ts               # 原生 node:http REST API + 静态托管
    main.ts                 # CLI 启动入口
public/
  index.html                # 零依赖单页前端（墨色极简，今日/素材库/写作台/采集/复习）
web/                        # ★ 按设计方案 v2.2 高保真落地的 React+Vite 前端（推荐）
  src/screens/              # 五大界面组件（今日/素材库/写作台/采集/复习）
  src/styles/               # design.css（设计令牌）+ app.css（响应式外壳）
  preview/                  # 桌面 5 屏 + 移动 5 屏预览图
  README.md                 # 前端启动与构建说明
docs/design/                # 界面设计方案 v2.2（自包含 HTML + 10 张预览图）
tests/                      # 10 个测试文件，76 个用例
vault/library/inbox/        # 共享库（拾页写入，砚田只读）
```

> **前端二选一**：`public/index.html` 是零依赖极简版（随后端静态托管）；`web/` 是精致的 React+Vite 版（设计稿高保真还原，独立运行，见 [web/README.md](web/README.md)）。两者对接同一套 REST API。

## 运行

```bash
pnpm install
pnpm run verify      # typecheck + 全部测试
pnpm run test        # 仅测试
pnpm run typecheck   # 仅类型检查
```

当前状态：**76 个测试全部通过（10 个测试文件），类型检查无错误**。

## P0 关键能力

1. **共享笔记契约**：字段完全对齐拾页 `EntryFile.kt`/`Library.kt` 实读格式（`source_id` 从文件名 `yyyyMMdd-HHmmss-hash` 提取）。
2. **时间戳防漂移**：`JSON_SCHEMA` 自定义 YAML 引擎，避免 js-yaml 把 `captured_at` 的 ISO 时间戳（含 `+08:00`）转成 JS Date 对象。
3. **扩展字段隔离**：`x-yantian-*` 前缀追加扩展，不污染拾页既有字段。
4. **逐字约束（防误引底线）**：`content` 必须是原文 body 的逐字子串，否则拒绝入库。
5. **出处强制**：`origin.url` 缺失拒绝入库；精确去重；状态机 `unprocessed → candidate → confirmed → used`；JSONL 容错存储。

## P1 关键能力

1. **共享库扫描器**（`vault-scanner.ts`）：递归 `library/**/*.md`，基于文件字节 sha256 指纹对比清单，识别新增/更新/删除；**只读铁律**——绝不修改拾页原文，清单写在我方 `.yantian/`。清单损坏自动降级全量重扫。
2. **FTS5 trigram 检索**（`search-index.ts`）：中文子串匹配（如「基层治理」命中长句），笔记 + 卡片双索引；全文召回 + 内存多维过滤（type/status/topics/scenes/site）；snippet 高亮、bm25 相关性排序；索引可按来源增量删除、可整体重建。索引是**可重建的派生数据**，事实源仍是 jsonl 与原文。
3. **导出导入包**（`export-import.ts`）：zip 内 `manifest.json`（逐文件 SHA256 防篡改）+ `cards.jsonl` + `notes/*.md`；导入时校验完整性、重新执行逐字约束与出处强制、**幂等去重**（换设备重复导入无副本）。
4. **手动导入通道**（`manualImport`）：用户从原文选段入库，逐字约束仍强制，复用 P0 `createCard` 避免逻辑漂移。
5. **端到端链路测试**：拾页原文 → 扫描 → 手动导入 → 索引 → 中文检索 → 导出 → 跨设备再导入 → 幂等，全链路打通。

## 过程中修复的真实问题

- **better-sqlite3 13.2.0 段错误**：预编译二进制在本环境加载成功但 `new Database()` 崩溃（exit 139）。降级并锁定 **11.10.0**（源码编译）后解决。
- **fflate `zipSync(Map)` 产出空包**：改为普通对象传入后正常。
- **js-yaml 时间戳类型漂移**（P0）：自定义 JSON_SCHEMA 引擎逐字保留溯源时间。

## P2 关键能力

1. **应用状态层**（`app-state.ts`）：统一封装 vault/卡片/索引/扫描；`syncFromVault()` 把新增/变更原文补进索引、删除来源清索引（卡片保留）；索引丢失可从 jsonl 自动回填。
2. **可插拔 AI 抽取器**（`extractor.ts`）：默认 `RuleExtractor`（零依赖、离线可用，按标点切句 + 信号词打分抽金句/标题）；`OllamaExtractor`（本地模型，注入式 HTTP）+ `FallbackExtractor`（模型失败自动回退规则）预留；**所有候选强制逐字校验**，非原文片段直接丢弃，且只产出 candidate 待人工确认。
3. **主题归纳与复习**（`review.ts`）：按主题聚合写作素材包（金句/标题/实践/好文章 + 引用文本）、内置四大遴选主题导航、复习卡只收已确认素材、按掌握度「待巩固优先」排序。
4. **本地 HTTP 服务**（`server.ts`）：原生 `node:http`，零新增依赖；18 个 REST API（扫描/检索/卡片 CRUD/抽取/确认/导入导出/复习/统计）；静态托管带目录穿越防护；只监听 127.0.0.1。
5. **Web 前端**（两套，共享同一 REST API）：
   - `public/index.html`：零依赖单页、墨色极简风（呼应拾页慢读调性），随后端静态托管，双击即用。
   - `web/`（推荐）：React 18 + Vite 6 高保真前端，完整移植 v2.2 设计令牌（藏青墨蓝+暖金、宋体衬线），桌面三栏工作台 + 移动端单列（底部 5 标签），5 个视图——今日（Hero/统计/趋势）、素材库（搜索/筛选/详情）、写作台（素材包/编辑器/复制引用）、采集（原文/AI 候选确认）、复习（翻卡/掌握度）。后端在线用真实数据，离线演示数据兜底。详见 [web/README.md](web/README.md)。

## 全链路冒烟验证

真实启动服务（`pnpm start`）+ curl 验证：健康检查 200、前端首页 200、扫描、中文子串检索（snippet 高亮）、AI 抽取（5 候选/0 丢弃）全部通过。

## 可选增强（非阻塞，按需再做）

- 接入真实本地模型：配置 Ollama（默认 `qwen2.5:7b`）后，把 `FallbackExtractor` 换成 `OllamaExtractor` 即可启用模型抽取。
- 拾页「导出到公共目录」小改造，用 Syncthing 替代导入包，打通手机↔电脑自动同步。
- 前端深色夜读模式、「我的专题」自建分组。
