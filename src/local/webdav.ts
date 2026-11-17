// 坚果云 WebDAV 同步（能力抽象）
// - 配置由用户在 App 内填写（应用专用密码，不写死在代码里）
// - 浏览器端：fetch（可在此环境用 mock 验证）
// - Capacitor Android：CapacitorHttp 插件发起请求，绕过 WebView CORS
// 只同步 md 原文（library/）；卡片/索引留本机自动重建，从架构上消灭多端冲突。

import { Capacitor } from '@capacitor/core';
import { kv, noteStore } from './store';

export interface WebDavConfig {
  baseUrl: string;      // 例如 https://dav.jianguoyun.com/dav/yantian
  username: string;     // 坚果云账号邮箱
  appPassword: string;  // 应用专用密码（非登录密码）
  autoUpload: boolean;
}

const CFG_KEY = 'webdav-config';
export const defaultWebDavConfig: WebDavConfig = {
  baseUrl: '', username: '', appPassword: '', autoUpload: false,
};

export async function getWebDavConfig(): Promise<WebDavConfig> {
  return kv.get<WebDavConfig>(CFG_KEY, defaultWebDavConfig);
}
export async function setWebDavConfig(cfg: WebDavConfig): Promise<void> {
  await kv.set(CFG_KEY, cfg);
}
export function isWebDavConfigured(cfg: WebDavConfig): boolean {
  return !!(cfg.baseUrl.trim() && cfg.username.trim() && cfg.appPassword.trim());
}

function authHeader(cfg: WebDavConfig): string {
  return 'Basic ' + btoa(`${cfg.username}:${cfg.appPassword}`);
}

interface HttpResp { ok: boolean; status: number; text: string; }
async function http(url: string, method: string, headers: Record<string, string>, data?: string): Promise<HttpResp> {
  if (Capacitor.isNativePlatform()) {
    // 原生 HTTP 插件在 CI 若未安装则回退 fetch
    try {
      // 原生 HTTP 插件为可选依赖；用变量路径避免打包器静态解析失败
      const pluginId = '@capacitor-community/http';
      const mod = await import(/* @vite-ignore */ pluginId) as { Http: { request(o: Record<string, unknown>): Promise<{ status: number; data: unknown }> } };
      const r = await mod.Http.request({ url, method, headers, data });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
    } catch { /* 插件不可用 → 走 fetch */ }
  }
  const res = await fetch(url, { method, headers, body: data });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/** 确保远端目录存在（MKCOL，逐级创建，409 视为已存在） */
async function ensureDir(cfg: WebDavConfig, dirPath: string): Promise<void> {
  const segs = dirPath.split('/').filter(Boolean);
  let cur = cfg.baseUrl.replace(/\/$/, '');
  for (const seg of segs) {
    cur += '/' + encodeURIComponent(seg);
    const r = await http(cur, 'MKCOL', { Authorization: authHeader(cfg) });
    if (!(r.ok || r.status === 405 || r.status === 409)) {
      throw new Error(`创建目录失败 ${seg}: HTTP ${r.status}`);
    }
  }
}

/** 上传一篇 md 到远端 library/ */
export async function uploadNote(note: { filePath: string; raw: string }, cfg?: WebDavConfig): Promise<void> {
  const conf = cfg || await getWebDavConfig();
  if (!isWebDavConfigured(conf)) throw new Error('尚未配置坚果云 WebDAV');
  await ensureDir(conf, 'library');
  const name = note.filePath.split('/').pop() || 'note.md';
  const url = `${conf.baseUrl.replace(/\/$/, '')}/library/${encodeURIComponent(name)}`;
  const r = await http(url, 'PUT', {
    Authorization: authHeader(conf),
    'Content-Type': 'text/markdown; charset=utf-8',
  }, note.raw);
  if (!r.ok) throw new Error(`上传失败 ${name}: HTTP ${r.status}`);
}

/** 上传全部本地 md（首次同步） */
export async function uploadAll(cfg?: WebDavConfig): Promise<number> {
  const notes = await noteStore.list();
  let n = 0;
  for (const note of notes) { await uploadNote(note, cfg); n++; }
  return n;
}

/** PROPFIND 列出远端 library/*.md 名称 */
export async function listRemote(cfg?: WebDavConfig): Promise<string[]> {
  const conf = cfg || await getWebDavConfig();
  if (!isWebDavConfigured(conf)) throw new Error('尚未配置坚果云 WebDAV');
  const url = `${conf.baseUrl.replace(/\/$/, '')}/library/`;
  const r = await http(url, 'PROPFIND', {
    Authorization: authHeader(conf), Depth: '1', 'Content-Type': 'application/xml',
  }, `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`);
  if (!r.ok && r.status !== 207) throw new Error(`列目录失败: HTTP ${r.status}`);
  const names = [...r.text.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map(m => decodeURIComponent(m[1].split('/').pop() || ''));
  return names.filter(n => n.endsWith('.md'));
}

/** 下载远端 md 文本 */
export async function downloadNote(name: string, cfg?: WebDavConfig): Promise<string> {
  const conf = cfg || await getWebDavConfig();
  const url = `${conf.baseUrl.replace(/\/$/, '')}/library/${encodeURIComponent(name)}`;
  const r = await http(url, 'GET', { Authorization: authHeader(conf) });
  if (!r.ok) throw new Error(`下载失败 ${name}: HTTP ${r.status}`);
  return r.text;
}

/** 测试连接（PROPFIND 根目录） */
export async function testConnection(cfg: WebDavConfig): Promise<{ ok: boolean; message: string }> {
  if (!isWebDavConfigured(cfg)) return { ok: false, message: '请填写完整地址、账号与应用专用密码' };
  try {
    await ensureDir(cfg, 'library');
    return { ok: true, message: '连接成功，library/ 目录就绪' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '连接失败' };
  }
}
