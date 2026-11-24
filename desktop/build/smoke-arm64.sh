#!/usr/bin/env bash
# 砚田 · arm64 deb 冒烟验证
#
# 在 x64 机器上用 QEMU 跑一个 debian:10（glibc 2.28，与统信 UOS V20 同基线）arm64 容器：
#   * 解开 deb，确认 node / electron / better_sqlite3.node 都是 aarch64
#   * 自带 node 能在旧 glibc 上启动
#   * 起服务、扫描拾页库、中文 FTS5 检索命中、前端托管
#
# 不在容器里装任何 apt 包（避免 qemu 下 apt 慢/抖动）：
#   - 架构检查用 ELF 魔数（od）
#   - HTTP 检查复用 deb 内自带的 node
# 用法：bash desktop/build/smoke-arm64.sh [deb 路径]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
DEB="${1:-$(ls -1 dist-deb/*.deb | head -n 1)}"
DEB="$(cd "$(dirname "$DEB")" && pwd)/$(basename "$DEB")"
echo "冒烟对象：$DEB"

OUT="$(mktemp)"
set +e
timeout 900 docker run --rm -i --platform linux/arm64 -v "$DEB:/pkg.deb:ro" debian:10 bash -s <<'EOS' > "$OUT" 2>&1
set -e
echo "== 解包 =="
rm -rf /opt/a && mkdir -p /opt/a
dpkg-deb -x /pkg.deb /opt/a
APP=/opt/a/usr/lib/yantian
NODE="$APP/node/bin/node"

# ELF 魔数 + e_machine 检查（b7 00 = aarch64）
is_arm64() {
  [ "$(head -c 4 "$1" | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] || return 1
  [ "$(head -c 20 "$1" | tail -c 2 | od -An -tx1 | tr -d ' \n')" = "b700" ]
}

echo "== 架构检查 =="
for f in "$NODE" "$APP/electron/electron"; do
  if is_arm64 "$f"; then echo "  aarch64 OK: ${f#/opt/a}"; else echo "FAIL: 不是 arm64 → $f"; exit 1; fi
done

echo "== 自带 node 启动（glibc 2.28）=="
"$NODE" -v

echo "== 准备素材库 =="
rm -rf /vault && mkdir -p /vault/library/inbox
cat > /vault/library/inbox/20261120-101010-0a1b2c3d-uos-smoke.md <<'NOTE'
---
title: 统信适配冒烟测试
source_url: https://mp.weixin.qq.com/s/uos-smoke
source_type: wechat
site: mp.weixin.qq.com
author: 测试
captured_at: 2026-11-20T10:10:10+08:00
category: inbox
tags: [信创, 冒烟]
status: inbox
content_hash: 0a1b2c3d
quality: clean
ocr: none
---

基层治理的关键，是把群众身边的每一件小事办实。麒麟 9000X 上的统信 UOS 也能跑起来。
NOTE

echo "== 启动服务 =="
"$NODE" "$APP/app/dist/p2/main.js" /vault 18765 > /tmp/server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

"$NODE" -e '
const http = require("http");
const get = (p) => new Promise((res, rej) => {
  const r = http.get({ host: "127.0.0.1", port: 18765, path: p, timeout: 4000 }, (s) => {
    let d = ""; s.on("data", (c) => d += c); s.on("end", () => res({ code: s.statusCode, body: d }));
  });
  r.on("error", rej); r.on("timeout", () => { r.destroy(); rej(new Error("timeout")); });
});
const post = (p) => new Promise((res, rej) => {
  const req = http.request({ host: "127.0.0.1", port: 18765, path: p, method: "POST" }, (s) => {
    let d = ""; s.on("data", (c) => d += c); s.on("end", () => res({ code: s.statusCode, body: d }));
  });
  req.on("error", rej); req.end();
});
(async () => {
  let up = false;
  for (let i = 0; i < 180; i++) {
    try { const r = await get("/api/health"); if (r.code === 200) { up = true; break; } } catch {}
    await new Promise((s) => setTimeout(s, 1000));
  }
  if (!up) { console.error("FAIL: 服务未就绪"); try { console.error(require("fs").readFileSync("/tmp/server.log", "utf8")); } catch {} process.exit(1); }
  const print = (name, r) => console.log(name + ": " + String(r.body).slice(0, 220));
  print("health", await get("/api/health"));
  print("scan", await post("/api/scan"));
  const search = await get("/api/search?q=" + encodeURIComponent("基层治理"));
  print("search", search);
  if (!search.body.includes("基层治理")) { console.error("FAIL: 中文 FTS5 检索未命中"); process.exit(1); }
  const stats = await get("/api/stats");
  if (!stats.body.includes("\"notes\":1")) { console.error("FAIL: 索引里没有笔记: " + stats.body); process.exit(1); }
  const index = await get("/");
  if (!index.body.includes("砚田")) { console.error("FAIL: 前端页面未托管"); process.exit(1); }
  console.log("index: " + index.code + " " + index.body.length + "B");
  console.log("SMOKE OK");
  process.exit(0);
})().catch((e) => { console.error("FAIL: " + (e && e.message || e)); try { console.error(require("fs").readFileSync("/tmp/server.log", "utf8")); } catch {} process.exit(1); });
'
RC=$?
if [ "$RC" -ne 0 ]; then
  echo "== server.log =="
  cat /tmp/server.log || true
  exit 1
fi
echo "SMOKE OK"
EOS
CODE=$?
set -e

cat "$OUT"
if [ $CODE -ne 0 ] || ! grep -q 'SMOKE OK' "$OUT"; then
  echo "冒烟失败（docker exit=$CODE）"
  exit 1
fi
echo "冒烟通过 ✅"