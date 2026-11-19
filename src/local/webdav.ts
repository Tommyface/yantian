// 坚果云 WebDAV 同步（能力抽象）
// - 配置由用户在 App 内填写（应用专用密码，不写死在代码里）
// - 浏览器端：fetch（可在此环境用 mock 验证）
// - Capacitor Android：CapacitorHttp 插件发起请求，绕过 WebView CORS
// 只同步 md 原文（library/）；卡片/索引留本机自动重建，从架构上消灭多端冲突。
//
// 增量策略：PROPFIND 时保留每个文件的 ETag，写入本地同步清单；下次同步只下载
// ETag 变化或本地缺失的文件，未变化的直接跳过，避免坚果云限流。请求带节流与 429 退避。

import { Capacitor } from '@capacitor/core';
import { kv, noteStore } from './store';

export interface WebDavConfig {
  baseUrl: string;      // 例如 https://dav.jianguoyun.com/dav/yantian
  username: string;     // 坚果云账号邮箱
  appPassword: string;  // 应用专用密码（非登录密码）
  autoUpload: boolean;
}

/** 远端单个文件：文件名 + ETag（增量同步的变更标记） */
export interface RemoteEntry { name: string; etag: string }

/** 同步清单：记录每个远端文件上次成功同步时的 ETag */
export interface SyncManifest {
  etags: Record<string, string>;  // 文件名 -> ETag
  initialized: boolean;           // 是否已完成过一次完整同步（用于防止首次误删本地）
}

const CFG_KEY = 'webdav-config';
const MANIFEST_KEY = 'webdav-sync-manifest';
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

export async function getSyncManifest(): Promise<SyncManifest> {
  return kv.get<SyncManifest>(MANIFEST_KEY, { etags: {}, initialized: false });
}
export async function setSyncManifest(m: SyncManifest): Promise<void> {
  await kv.set(MANIFEST_KEY, m);
}

function authHeader(cfg: WebDavConfig): string {
  return 'Basic ' + btoa(`${cfg.username}:${cfg.appPassword}`);
}

interface HttpResp { ok: boolean; status: number; text: string; headers: Record<string, string>; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rawHttp(url: string, method: string, headers: Record<string, string>, data?: string): Promise<HttpResp> {
  if (Capacitor.isNativePlatform()) {
    // 原生 HTTP 插件在 CI 若未安装则回退 fetch
    try {
      const pluginId = '@capacitor-community/http';
      const mod = await import(/* @vite-ignore */ pluginId) as { Http: { request(o: Record<string, unknown>): Promise<{ status: number; data: unknown; headers?: Record<string, string> }> } };
      const r = await mod.Http.request({ url, method, headers, data });
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data), headers: r.headers || {} };
    } catch { /* 插件不可用 → 走 fetch */ }
  }
  const res = await fetch(url, { method, headers, body: data });
  const respHeaders: Record<string, string> = {};
  try { res.headers.forEach((v, k) => { respHeaders[k.toLowerCase()] = v; }); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, text: await res.text(), headers: respHeaders };
}

/** 带 429 退避的请求：坚果云限流时按 Retry-After 等待后重试，最多 3 次。 */
async function http(url: string, method: string, headers: Record<string, string>, data?: string): Promise<HttpResp> {
  const MAX_RETRY = 3;
  for (let attempt = 0; ; attempt++) {
    const r = await rawHttp(url, method, headers, data);
    if (r.status !== 429 || attempt >= MAX_RETRY) return r;
    const ra = Number(r.headers['retry-after'] ?? r.text.match(/Retry-After:\s*(\d+)/i)?.[1]);
    const waitSec = Number.isFinite(ra) ? Math.min(Math.max(ra, 1), 60) : Math.min(1 << attempt, 8);
    await sleep(waitSec * 1000);
  }
}

/** 确保远端目录存在（MKCOL，逐级创建，409/405/403 视为已存在） */
async function ensureDir(cfg: WebDavConfig, dirPath: string): Promise<void> {
  const segs = dirPath.split('/').filter(Boolean);
  let cur = cfg.baseUrl.replace(/\/$/, '');
  for (const seg of segs) {
    cur += '/' + encodeURIComponent(seg);
    const r = await http(cur, 'MKCOL', { Authorization: authHeader(cfg) });
    if (!(r.ok || r.status === 405 || r.status === 409 || r.status === 403)) {
      throw new Error(`创建目录失败 ${seg}: HTTP ${r.status}`);
    }
    await sleep(60); // 节流
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
  await sleep(60);
}

/** 上传全部本地 md（首次同步） */
export async function uploadAll(cfg?: WebDavConfig): Promise<number> {
  const notes = await noteStore.list();
  let n = 0;
  for (const note of notes) { await uploadNote(note, cfg); n++; }
  return n;
}

/**
 * PROPFIND 列出远端 library/*.md，保留每个文件的 ETag。
 * 以 <response> 块为单位配对 href 与 getetag，兼容命名空间前缀差异。
 */
export async function listRemoteEntries(cfg?: WebDavConfig): Promise<RemoteEntry[]> {
  const conf = cfg || await getWebDavConfig();
  if (!isWebDavConfigured(conf)) throw new Error('尚未配置坚果云 WebDAV');
  const url = `${conf.baseUrl.replace(/\/$/, '')}/library/`;
  const r = await http(url, 'PROPFIND', {
    Authorization: authHeader(conf), Depth: '1', 'Content-Type': 'application/xml',
  }, `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`);
  if (!r.ok && r.status !== 207) throw new Error(`列目录失败: HTTP ${r.status}`);
  const entries: RemoteEntry[] = [];
  const respRe = /<(?:[A-Za-z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/gi;
  const hrefRe = /<(?:[A-Za-z0-9_-]+:)?href>([^<]+)<\/(?:[A-Za-z0-9_-]+:)?href>/i;
  const etagRe = /<(?:[A-Za-z0-9_-]+:)?getetag>([^<]*)<\/(?:[A-Za-z0-9_-]+:)?getetag>/i;
  for (const m of r.text.matchAll(respRe)) {
    const block = m[1];
    const href = block.match(hrefRe)?.[1];
    if (!href) continue;
    if (href.split('/').some(s => s === '..' || s.toLowerCase() === '%2e%2e')) continue;
    let name: string;
    try { name = decodeURIComponent(href.split('/').pop() || ''); } catch { continue; }
    if (!/\.md$/i.test(name) || name.includes('..')) continue;
    const etag = (block.match(etagRe)?.[1] || '').trim();
    entries.push({ name, etag });
  }
  return entries;
}

/** 兼容旧调用：只返回文件名数组 */
export async function listRemote(cfg?: WebDavConfig): Promise<string[]> {
  return (await listRemoteEntries(cfg)).map(e => e.name);
}

/** 下载远端 md 文本 */
export async function downloadNote(name: string, cfg?: WebDavConfig): Promise<string> {
  const conf = cfg || await getWebDavConfig();
  const url = `${conf.baseUrl.replace(/\/$/, '')}/library/${encodeURIComponent(name)}`;
  const r = await http(url, 'GET', { Authorization: authHeader(conf) });
  if (!r.ok) throw new Error(`下载失败 ${name}: HTTP ${r.status}`);
  await sleep(60); // 节流
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
