#!/usr/bin/env bash
# 砚田 · 统信 UOS（arm64）deb 打包脚本
#
# 在 ubuntu x64 上交叉构建（GitHub Actions 里跑）：
#   bash desktop/build/build-deb.sh
# 产物：dist-deb/yantian_<version>_arm64.deb + .sha256
#
# 关键点：
#  * 自带 node 22（linux-arm64）与 Electron 22（linux-arm64），不依赖系统 node；
#  * better-sqlite3 用官方 linux-arm64 预编译包（node-v127），避免在 CI 上交叉编译原生模块；
#  * Electron 只当外壳，业务跑在原生 node 服务里，因此不改任何 Electron ABI。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

APP_ID="yantian"
APP_NAME="砚田"
APP_DIR="/usr/lib/yantian"
VERSION="$(node -p "require('./package.json').version")"
DEB_VERSION="${VERSION}+uos1"
NODE_VERSION="${NODE_VERSION:-24.9.0}"   # node:sqlite 内置 FTS5；21.x 的内置 SQLite 没有 FTS5
ELECTRON_VERSION="${ELECTRON_VERSION:-22.3.27}"
WORK="$ROOT/.build"
STAGE="$WORK/stage"
OUT="$ROOT/dist-deb"

log() { printf '\033[1;36m[build]\033[0m %s\n' "$*"; }

rm -rf "$WORK"
mkdir -p "$STAGE" "$OUT" "$WORK/cache"

# ---------------------------------------------------------------- 1. 编译服务端
log "安装依赖并编译 TypeScript → dist/"
npm install --no-audit --no-fund
npx tsc -p tsconfig.build.json
test -f dist/p2/main.js || { echo "编译失败：dist/p2/main.js 不存在"; exit 1; }

# ---------------------------------------------------------------- 2. 应用目录
log "组装应用目录 $APP_DIR"
APPDIR="$STAGE$APP_DIR/app"
mkdir -p "$APPDIR"
cp -r dist "$APPDIR/dist"
cp -r public "$APPDIR/public"
cp package.json "$APPDIR/package.json"
cp -r desktop/shell "$STAGE$APP_DIR/shell"

# 生产依赖：砚田已改用 node:sqlite，全部为纯 JS 包
log "安装生产依赖（全部纯 JS，无原生模块）"
(
  cd "$APPDIR"
  npm install --omit=dev --no-audit --no-fund --ignore-scripts
)
if [ -d "$APPDIR/node_modules/better-sqlite3" ] || [ -d "$APPDIR/node_modules/typescript" ]; then
  echo "生产依赖里混入了 better-sqlite3/typescript"; exit 1
fi
node -p "JSON.stringify(Object.keys(require('$APPDIR/package.json').dependencies))"

# ---------------------------------------------------------------- 3. Node 运行时
log "下载 node v$NODE_VERSION linux-arm64"
NODE_TAR="$WORK/cache/node.tar.xz"
curl -fsSL --retry 3 -o "$NODE_TAR" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-arm64.tar.xz" \
  || curl -fsSL --retry 3 -o "$NODE_TAR" "https://registry.npmmirror.com/-/binary/node/v$NODE_VERSION/node-v$NODE_VERSION-linux-arm64.tar.xz"
mkdir -p "$WORK/node" "$STAGE$APP_DIR/node/bin"
tar -xJf "$NODE_TAR" -C "$WORK/node" --strip-components=1
cp "$WORK/node/bin/node" "$STAGE$APP_DIR/node/bin/node"
chmod 755 "$STAGE$APP_DIR/node/bin/node"
if command -v file >/dev/null 2>&1; then file "$STAGE$APP_DIR/node/bin/node"; fi

# ---------------------------------------------------------------- 4. Electron
log "下载 Electron v$ELECTRON_VERSION linux-arm64"
EL_ZIP="$WORK/cache/electron.zip"
curl -fsSL --retry 3 -o "$EL_ZIP" \
  "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-arm64.zip" \
  || curl -fsSL --retry 3 -o "$EL_ZIP" \
  "https://registry.npmmirror.com/-/binary/electron/$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-arm64.zip"
mkdir -p "$STAGE$APP_DIR/electron"
unzip -q "$EL_ZIP" -d "$STAGE$APP_DIR/electron"
rm -f "$STAGE$APP_DIR/electron/resources/default_app.asar"
# 只留中文与英文语言包，减小体积
if [ -d "$STAGE$APP_DIR/electron/locales" ]; then
  find "$STAGE$APP_DIR/electron/locales" -name '*.pak' ! -name 'zh-CN.pak' ! -name 'en-US.pak' -delete
fi
chmod 755 "$STAGE$APP_DIR/electron/electron"

# ---------------------------------------------------------------- 5. 图标与启动器
log "写入图标、启动脚本与 desktop 文件"
install -D -m 644 desktop/assets/yantian.png "$STAGE/usr/share/icons/hicolor/256x256/apps/yantian.png"
install -D -m 644 desktop/assets/yantian.png "$STAGE$APP_DIR/icon.png"

mkdir -p "$STAGE$APP_DIR/bin" "$STAGE/usr/bin"

cat > "$STAGE$APP_DIR/bin/yantian-server" <<'EOS'
#!/bin/sh
# 只跑本地服务（排障用）：yantian-server [素材库目录] [端口]
VAULT="${1:-$HOME/文档/砚田库}"
PORT="${2:-8765}"
mkdir -p "$VAULT"
exec /usr/lib/yantian/node/bin/node /usr/lib/yantian/app/dist/p2/main.js "$VAULT" "$PORT"
EOS

cat > "$STAGE$APP_DIR/bin/yantian-browser" <<'EOS'
#!/bin/sh
# 浏览器模式（Electron 起不来时的兜底）：yantian-browser [素材库目录]
VAULT="${1:-$HOME/文档/砚田库}"
PORT="${YANTIAN_PORT:-8765}"
NODE=/usr/lib/yantian/node/bin/node
mkdir -p "$VAULT"
"$NODE" /usr/lib/yantian/app/dist/p2/main.js "$VAULT" "$PORT" &
PID=$!
trap 'kill "$PID" 2>/dev/null' INT TERM EXIT
i=0
while [ "$i" -lt 80 ]; do
  if "$NODE" -e "const h=require('http');const r=h.get({host:'127.0.0.1',port:$PORT,path:'/api/health'},s=>{s.resume();process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(1000,()=>process.exit(1));" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 0.5
done
xdg-open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 &
wait "$PID"
EOS

cat > "$STAGE/usr/bin/yantian" <<'EOS'
#!/bin/sh
# 砚田启动器：窗口失败自动降级浏览器模式，报错写日志
APP=/usr/lib/yantian
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/yantian"
LOG_DIR="$CONF_DIR/logs"
LAUNCH_LOG="$LOG_DIR/launch.log"
mkdir -p "$LOG_DIR" 2>/dev/null
case "$1" in
  --browser) shift; exec "$APP/bin/yantian-browser" "$@" ;;
  --server)  shift; exec "$APP/bin/yantian-server" "$@" ;;
esac
echo "==== $(date '+%F %T') 启动（窗口模式）====" >>"$LAUNCH_LOG"
"$APP/electron/electron" --no-sandbox --disable-gpu "$APP/shell" "$@" >>"$LAUNCH_LOG" 2>&1
CODE=$?
if [ "$CODE" -ne 0 ]; then
  echo "==== $(date '+%F %T') Electron 退出码 $CODE，降级浏览器模式 ====" >>"$LAUNCH_LOG"
  command -v notify-send >/dev/null 2>&1 && notify-send "砚田" "窗口启动失败，已切换到浏览器模式。日志：$LAUNCH_LOG" >/dev/null 2>&1 || true
  exec "$APP/bin/yantian-browser" "$@"
fi
EOS
chmod 755 "$STAGE$APP_DIR/bin/yantian-server" "$STAGE$APP_DIR/bin/yantian-browser" "$STAGE/usr/bin/yantian"

mkdir -p "$STAGE/usr/share/applications"
cat > "$STAGE/usr/share/applications/yantian.desktop" <<EOD
[Desktop Entry]
Type=Application
Version=1.0
Name=砚田
Name[zh_CN]=砚田
GenericName=素材知识库
Comment=遴选启作素材知识库（本地服务 + 本地素材库，数据不出本机）
Comment[zh_CN]=遴选启作素材知识库（本地服务 + 本地素材库，数据不出本机）
Exec=/usr/bin/yantian
Icon=yantian
Terminal=false
Categories=Office;Utility;TextTools;
Keywords=砚田;素材;知识库;写作;
StartupWMClass=yantian
StartupNotify=true
NoDisplay=false
EOD

chmod 644 "$STAGE/usr/share/applications/yantian.desktop"

# ---------------------------------------------------------------- 6. deb 元数据
log "生成 DEBIAN 控制信息"
SIZE_KB="$(du -sk "$STAGE" | awk '{print $1}')"
mkdir -p "$STAGE/DEBIAN"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: $APP_ID
Version: $DEB_VERSION
Architecture: arm64
Maintainer: Tommy <tommyface@users.noreply.github.com>
Installed-Size: $SIZE_KB
Section: utils
Priority: optional
Homepage: https://github.com/Tommyface/yantian
Depends: libgtk-3-0, libnss3, libnspr4, libasound2, libatk1.0-0, libatk-bridge2.0-0, libcups2, libdrm2, libgbm1, libx11-6, libx11-xcb1, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxrandr2, libxrender1, libxtst6, libxi6, libxkbcommon0, libpango-1.0-0, libcairo2, libexpat1, libstdc++6, fonts-noto-cjk
Recommends: fonts-noto-cjk-extra
Description: 砚田 · 遴选启作素材知识库（统信 UOS / arm64）
 本地 Node 服务 + 本地素材库，浏览器窗口只连 127.0.0.1，数据不出本机。
 读取拾页写入的 Markdown 素材库，做检索、素材卡片与写作台。
EOF

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ -x /usr/lib/yantian/electron/chrome-sandbox ]; then
  chown root:root /usr/lib/yantian/electron/chrome-sandbox 2>/dev/null || true
  chmod 4755 /usr/lib/yantian/electron/chrome-sandbox 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi
exit 0
EOF

cat > "$STAGE/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
# 退出正在运行的实例，避免卸载后残留进程占着文件
pkill -f '/usr/lib/yantian/electron/electron' >/dev/null 2>&1 || true
pkill -f '/usr/lib/yantian/app/dist/p2/main.js' >/dev/null 2>&1 || true
exit 0
EOF

chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm"

DEB="$OUT/${APP_ID}_${DEB_VERSION}_arm64.deb"
dpkg-deb --root-owner-group -Zxz --build "$STAGE" "$DEB" >/dev/null
( cd "$OUT" && sha256sum "$(basename "$DEB")" > "$(basename "$DEB").sha256" )

log "完成：$DEB ($(du -h "$DEB" | awk '{print $1}'))"
cat "$OUT/$(basename "$DEB").sha256"