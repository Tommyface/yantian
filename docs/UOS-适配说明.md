# 砚田 · 统信 UOS 桌面版（arm64）适配说明

目标设备：软通华方 / 华为擎云（麒麟 9000X，aarch64）+ 统信 UOS 桌面专业版 V20（1070 及以上，glibc 2.28 基线）。

桌面版架构：

```
Electron 22（arm64，仅做窗口）
   └── 加载 http://127.0.0.1:<空闲端口>
自带的 Node 24（linux-arm64）
   └── 跑砚田本地服务（dist/p2/main.js，检索用 Node 内置 node:sqlite，含 FTS5 trigram）
素材库：本机磁盘上的 Markdown（拾页 library/ 格式，砚田只读原文 + 索引）
```

设计取舍：

- **不依赖系统 Node**：deb 里自带 node 运行时，升级系统不影响砚田。
- **零原生模块**：检索层用 Node 内置 node:sqlite（FTS5/trigram 与 better-sqlite3 同引擎）。
  原因：better-sqlite3 官方 arm64 预编译包要求 GLIBC 2.29+，而 UOS V20 是 2.28，加载会失败；
  改内置模块后整个应用没有任何 .node 产物，跨发行版不再有 glibc 门槛。
- **Electron 22（Chromium 108）**：glibc 2.27 基线，在 UOS V20（2.28）上兼容性最好；默认禁用 GPU 合成（国产集显驱动差异大，本地工具页面对性能不敏感），需要时设 `YANTIAN_ENABLE_GPU=1`。
- **三档兜底**：应用窗口 → `yantian --browser`（起服务后用系统浏览器打开）→ `yantian --server`（纯命令行）。

## 安装

```bash
sudo dpkg -i yantian_<版本>_arm64.deb
sudo apt-get install -f   # 若提示缺依赖
```

依赖清单见 deb 的 `Depends`（libgtk-3-0、libnss3、libgbm1、fonts-noto-cjk 等，UOS V20 均在官方源内）。

安装后在启动器「办公/工具」分类里出现 **砚田** 图标；也可在终端执行：

```bash
yantian             # 图形窗口
yantian --browser   # 浏览器模式兜底
yantian --server ~/文档/砚田库 8765   # 纯服务
```

## 素材库

- 首次启动会弹目录选择，默认 `~/文档/砚田库`；配置存在 `~/.config/yantian/config.json`。
- 要和手机版拾页共用一个库：把拾页 WebDAV 同步下来的 `library` 所在目录选进来即可；菜单「素材库 → 切换素材库…」随时可换。
- 环境变量 `YANTIAN_VAULT=/path/to/vault` 可强制指定（配合自启动使用）。

## 与拾页的配合

拾页（手机/桌面）负责把微信、网页、PDF、Word 收成 `library/**/*.md`；砚田扫描该库做 FTS5 中文检索、素材卡片与写作台。两边只通过同一个 Markdown 目录协作，无私有数据库。

## 排障

| 现象 | 处理 |
|---|---|
| 双击图标无窗口 | 终端跑 `yantian --browser` 看报错；日志在 `~/.config/yantian/logs/server.log` |
| 窗口白屏/花屏 | 已默认禁 GPU；仍异常时 `YANTIAN_ENABLE_GPU=1 yantian` 对比验证 |
| 提示缺 libgtk/libnss 等 | `sudo apt-get install -f` 补齐依赖 |
| 服务启动失败 | 看 `server.log`；常见是素材库目录无写权限（换到 `~/文档` 下） |
| 端口被占 | 桌面版自动挑空闲端口；`--server` 模式手动指定端口 |

## 构建

```bash
bash desktop/build/build-deb.sh     # 交叉构建 arm64 deb
bash desktop/build/smoke-arm64.sh   # QEMU debian:10(arm64, glibc 2.28) 冒烟
```

GitHub Actions：`.github/workflows/uos-arm64.yml`，在 ubuntu x64 上交叉打包 arm64 deb，并用 QEMU 起 debian:10 容器验证「自带 node 可跑 + better-sqlite3 arm64 原生模块可用 + FTS5 中文检索 + 前端托管」，产物上传 artifact，打 tag 后自动发 Release。

## 已知边界

- 本地模型/AI 抽取接口（Ollama 等）沿用服务端预留配置，桌面版默认走规则抽取。
- Electron 22 较旧但仅渲染本地页面；若后续目标系统升级到 UOS 25/V23，可在 CI 用 `ELECTRON_VERSION=28.3.3` 重打包。
- 图标为生成的黑白字标，替换 `desktop/assets/yantian.png` 后重打包即可。

> AI生成
