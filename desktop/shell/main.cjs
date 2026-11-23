'use strict';
/**
 * 砚田 · 统信 UOS 桌面壳（Electron）
 *
 * 职责边界很窄：只做「找一个空闲端口 → 拉起本地 Node 服务 → 等健康检查 → 开窗口」。
 * 业务全部在 app/dist 里的原生 node 服务中跑，因此 Electron 只需要一个纯 JS 外壳，
 * 不涉及任何原生模块，也就不会出现 Electron ABI 与 better-sqlite3 不匹配的问题。
 *
 * 环境变量（排障用）：
 *   YANTIAN_ROOT       安装根目录（默认 __dirname/..）
 *   YANTIAN_NODE       自带的 node 可执行文件
 *   YANTIAN_CONF       配置目录（默认 ~/.config/yantian）
 *   YANTIAN_VAULT      跳过配置，强制指定素材库目录
 *   YANTIAN_ENABLE_GPU 设为 1 时启用 GPU 加速（默认关闭，避免国产显卡驱动异常）
 */

const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const os = require('node:os');

const ROOT = process.env.YANTIAN_ROOT || path.join(__dirname, '..');
const NODE_BIN = process.env.YANTIAN_NODE || path.join(ROOT, 'node', 'bin', 'node');
const SERVER_ENTRY = path.join(ROOT, 'app', 'dist', 'p2', 'main.js');
const ICON = path.join(ROOT, 'icon.png');
const CONF_DIR = process.env.YANTIAN_CONF || path.join(os.homedir(), '.config', 'yantian');
const CONF_FILE = path.join(CONF_DIR, 'config.json');
const LOG_DIR = path.join(CONF_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');

let mainWindow = null;
let serverProc = null;
let serverPort = 0;
let quitting = false;

// 国产显卡（麒麟 9000X 集显等）在旧版 Chromium 上跑 GPU 合成容易花屏/闪退，
// 本地工具页面对性能不敏感，默认走软件渲染最稳。
if (process.env.YANTIAN_ENABLE_GPU !== '1') {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONF_FILE, 'utf8')); } catch (_) { return {}; }
}

function writeConfig(cfg) {
  ensureDir(CONF_DIR);
  fs.writeFileSync(CONF_FILE, JSON.stringify(cfg, null, 2));
}

function defaultVault() {
  const home = os.homedir();
  for (const name of ['文档', 'Documents']) {
    const dir = path.join(home, name);
    if (fs.existsSync(dir)) return path.join(dir, '砚田库');
  }
  return path.join(home, '砚田库');
}

/** 素材库目录：环境变量 > 配置文件 > 首次启动时让用户选（默认 ~/文档/砚田库） */
function resolveVault(forcePick) {
  if (process.env.YANTIAN_VAULT) return process.env.YANTIAN_VAULT;
  const cfg = readConfig();
  if (!forcePick && cfg.vaultPath) return cfg.vaultPath;

  const fallback = cfg.vaultPath || defaultVault();
  ensureDir(fallback);
  const picked = dialog.showOpenDialogSync(mainWindow, {
    title: '选择砚田素材库（拾页同步下来的 library 文件夹所在的目录）',
    defaultPath: fs.existsSync(fallback) ? fallback : path.dirname(fallback),
    properties: ['openDirectory'],
    buttonLabel: '用这个目录',
  });
  const chosen = picked && picked[0] ? picked[0] : fallback;
  ensureDir(chosen);
  writeConfig(Object.assign({}, cfg, { vaultPath: chosen }));
  return chosen;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function appendLog(text) {
  ensureDir(LOG_DIR);
  try { fs.appendFileSync(LOG_FILE, text); } catch (_) { /* ignore */ }
}

function startServer(vault) {
  return getFreePort().then((port) => {
    serverPort = port;
    appendLog('\n==== ' + new Date().toISOString() + ' 启动 ' + NODE_BIN + ' ' + SERVER_ENTRY + ' ' + vault + ' ' + port + '\n');
    const child = spawn(NODE_BIN, [SERVER_ENTRY, vault, String(port)], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { NODE_ENV: 'production' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => appendLog(b.toString()));
    child.stderr.on('data', (b) => appendLog(b.toString()));
    child.on('exit', (code, signal) => {
      appendLog('==== 服务退出 code=' + code + ' signal=' + signal + '\n');
      if (!quitting) {
        dialog.showMessageBox({
          type: 'error',
          title: '砚田服务已退出',
          message: '本地服务进程意外退出（code=' + code + '）',
          detail: '日志：' + LOG_FILE + '\n可关闭窗口后重新打开砚田，或在终端执行 yantian --browser 查看报错。',
          buttons: ['知道了', '打开日志'],
          defaultId: 0,
        }).then((r) => { if (r.response === 1) shell.openPath(LOG_FILE); });
      }
    });
    serverProc = child;
    return port;
  });
}

function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 40000);
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('本地服务启动超时'));
      setTimeout(attempt, 400);
    };
    attempt();
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: '砚田',
    icon: ICON,
    backgroundColor: '#f5f5f4',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL('http://127.0.0.1:' + port + '/');
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: '素材库',
      submenu: [
        {
          label: '切换素材库…',
          click: () => {
            const vault = resolveVault(true);
            restartWithVault(vault);
          },
        },
        {
          label: '在文件管理器中打开',
          click: () => {
            const cfg = readConfig();
            if (cfg.vaultPath) shell.openPath(cfg.vaultPath);
          },
        },
        { type: 'separator' },
        { label: '重新扫描并刷新', click: () => mainWindow && mainWindow.reload() },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '打开日志', click: () => shell.openPath(LOG_FILE) },
        {
          label: '关于砚田',
          click: () => dialog.showMessageBox({
            type: 'info',
            title: '关于砚田',
            message: '砚田 · 统信 UOS 版',
            detail: '本地服务 + 本地素材库，数据不出本机。\nElectron ' + process.versions.electron +
              ' / Chromium ' + process.versions.chrome + '\nNode ' + process.versions.node + '（外壳）',
            buttons: ['好'],
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function restartWithVault(vault) {
  quitting = true;
  if (serverProc) { try { serverProc.kill('SIGTERM'); } catch (_) { /* ignore */ } }
  serverProc = null;
  quitting = false;
  startServer(vault)
    .then((port) => waitForHealth(port, 60000).then(() => port))
    .then((port) => { if (mainWindow) mainWindow.loadURL('http://127.0.0.1:' + port + '/'); })
    .catch((err) => showFatal(err));
}

function showFatal(err) {
  dialog.showMessageBox({
    type: 'error',
    title: '砚田启动失败',
    message: String(err && err.message ? err.message : err),
    detail: '日志：' + LOG_FILE + '\n也可以在终端执行 yantian --browser 以浏览器方式打开。',
    buttons: ['退出', '打开日志'],
    defaultId: 0,
  }).then((r) => {
    if (r.response === 1) shell.openPath(LOG_FILE);
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    const vault = resolveVault(false);
    return startServer(vault)
      .then((port) => waitForHealth(port))
      .then((port) => createWindow(port));
  }).catch(showFatal);

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    if (serverProc) { try { serverProc.kill('SIGTERM'); } catch (_) { /* ignore */ } }
  });
}