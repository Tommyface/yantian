/**
 * 本地 HTTP 服务（原生 node:http，零新增依赖）
 *
 * 提供两类能力：
 *  1. REST API —— 扫描/检索/卡片 CRUD/抽取/导入导出/复习/统计。
 *  2. 静态前端托管 —— 托管 public/ 下的单页界面。
 *
 * 只监听 127.0.0.1，数据不出本机，符合体制内数据安全要求。
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { AppState } from './app-state.js';
import { RuleExtractor, OllamaExtractor, FallbackExtractor, type Extractor } from './extractor.js';
import { buildTopicBundle, listTopicSummaries, buildReviewDeck, orderReviewDeck, toCitation } from './review.js';
import { manualImport, createExportBundle, importBundle } from '../p1/export-import.js';
import { canTransition } from '../p0/material-card.js';
import type { MaterialType, CompileStatus, Mastery, ExamTopic, Scene } from '../contracts/index.js';
import type { CardStore } from '../p0/material-card.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 前端静态目录（相对 src/p2 的 ../../public） */
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

export interface ServerOptions {
  app: AppState;
  port?: number;
  host?: string;
  /** AI 抽取后端（默认规则抽取）；可注入 Ollama/Fallback */
  extractor?: Extractor;
  /** 静态目录覆盖（测试用） */
  publicDir?: string;
}

interface ApiResponse {
  status: number;
  body: unknown;
  contentType?: string;
}

/** 解析 JSON body */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(Buffer.from(ch));
  const text = Buffer.concat(chunks).toString('utf-8');
  if (!text.trim()) return {};
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
}

function json(status: number, body: unknown): ApiResponse {
  return { status, body, contentType: 'application/json; charset=utf-8' };
}

/** MIME 映射 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

/**
 * API 路由处理（纯函数式，便于测试）。
 * 返回 null 表示不属于 API（交给静态托管）。
 */
export async function handleApi(
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
  opts: ServerOptions
): Promise<ApiResponse | null> {
  const { app } = opts;
  const extractor = opts.extractor ?? new RuleExtractor();

  // GET /api/health
  if (pathname === '/api/health' && method === 'GET') {
    return json(200, { ok: true, name: 'yantian', version: '0.3.0-p2', time: new Date().toISOString() });
  }

  // GET /api/stats
  if (pathname === '/api/stats' && method === 'GET') {
    return json(200, app.stats());
  }

  // POST /api/scan —— 扫描拾页库并同步索引
  if (pathname === '/api/scan' && method === 'POST') {
    const report = await app.syncFromVault();
    return json(200, report);
  }

  // GET /api/search?q=...&kind=&type=&status=&topic=&site=&limit=
  if (pathname === '/api/search' && method === 'GET') {
    const q = query.get('q') ?? '';
    const filters: Record<string, unknown> = {};
    if (query.get('kind')) filters.kind = query.get('kind');
    if (query.get('type')) filters.type = query.get('type');
    if (query.get('status')) filters.status = query.get('status');
    if (query.get('site')) filters.site = query.get('site');
    if (query.get('topic')) filters.topics = [query.get('topic')];
    if (query.get('limit')) filters.limit = Number(query.get('limit'));
    const hits = app.search(q, filters as never);
    return json(200, { total: hits.length, hits });
  }

  // GET /api/notes/:sourceId —— 取笔记原文（逐字核对）
  const noteMatch = pathname.match(/^\/api\/notes\/(.+)$/);
  if (noteMatch && method === 'GET') {
    const note = app.getNote(decodeURIComponent(noteMatch[1]));
    return note ? json(200, note) : json(404, { error: '笔记不存在' });
  }

  // GET /api/topics —— 主题概览
  if (pathname === '/api/topics' && method === 'GET') {
    return json(200, listTopicSummaries(app.cards.all()));
  }

  // GET /api/bundle?topic=... —— 写作台主题素材包
  if (pathname === '/api/bundle' && method === 'GET') {
    const topic = query.get('topic') ?? undefined;
    const bundle = buildTopicBundle(app.cards.all(), topic);
    // 附带引用文本，前端一键复制
    const withCitation = { ...bundle };
    for (const key of ['golden_sentence', 'subheading', 'practice', 'article'] as const) {
      (withCitation as never as Record<string, unknown>)[`${key}_cited`] = bundle[key].map(toCitation);
    }
    return json(200, withCitation);
  }

  // GET /api/review —— 复习卡组（待巩固优先）
  if (pathname === '/api/review' && method === 'GET') {
    return json(200, orderReviewDeck(buildReviewDeck(app.cards.all())));
  }

  // GET /api/cards —— 列出卡片
  if (pathname === '/api/cards' && method === 'GET') {
    return json(200, app.cards.all());
  }

  // POST /api/cards/manual —— 手动导入
  if (pathname === '/api/cards/manual' && method === 'POST') {
    const { sourceId, content, type, topics, scenes } = body;
    const note = app.getNote(String(sourceId ?? ''));
    if (!note) return json(404, { error: '原文不存在，请先扫描' });
    const mi = manualImport({
      note, type: (type as MaterialType) ?? 'golden_sentence', content: String(content ?? ''),
      topics: topics as ExamTopic[] | undefined, scenes: scenes as Scene[] | undefined,
    });
    if (!mi.ok || !mi.card) return json(400, { error: mi.errors.join('; ') });
    const add = await app.addCard(mi.card, note.body);
    if (!add.ok) return json(400, { error: add.errors.join('; ') });
    return json(201, mi.card);
  }

  // POST /api/extract —— AI 抽取候选（不入库，供人工确认）
  if (pathname === '/api/extract' && method === 'POST') {
    const sourceId = String(body.sourceId ?? '');
    const note = app.getNote(sourceId);
    if (!note) return json(404, { error: '原文不存在，请先扫描' });
    const result = await extractor.extract(note);
    return json(200, result);
  }

  // POST /api/cards/confirm —— 从抽取候选确认入库（逐字再次校验）
  if (pathname === '/api/cards/confirm' && method === 'POST') {
    const { sourceId, content, type, topics, scenes } = body;
    const note = app.getNote(String(sourceId ?? ''));
    if (!note) return json(404, { error: '原文不存在' });
    const mi = manualImport({
      note, type: (type as MaterialType) ?? 'golden_sentence', content: String(content ?? ''),
      topics: topics as ExamTopic[] | undefined, scenes: scenes as Scene[] | undefined,
    });
    if (!mi.ok || !mi.card) return json(400, { error: mi.errors.join('; ') });
    const add = await app.addCard(mi.card, note.body);
    if (!add.ok) return json(400, { error: add.errors.join('; ') });
    return json(201, mi.card);
  }

  // PATCH /api/cards/:id/status  {status}
  const statusMatch = pathname.match(/^\/api\/cards\/([^/]+)\/status$/);
  if (statusMatch && method === 'PATCH') {
    const id = decodeURIComponent(statusMatch[1]);
    const to = String(body.status ?? '') as CompileStatus;
    const card = app.cards.get(id);
    if (!card) return json(404, { error: '卡片不存在' });
    if (!canTransition(card.status, to)) return json(400, { error: `非法状态转换 ${card.status}→${to}` });
    const res = await app.updateCardStatus(id, to);
    return res.ok ? json(200, app.cards.get(id)) : json(400, { error: res.errors.join('; ') });
  }

  // PATCH /api/cards/:id/mastery  {mastery}
  const masteryMatch = pathname.match(/^\/api\/cards\/([^/]+)\/mastery$/);
  if (masteryMatch && method === 'PATCH') {
    const id = decodeURIComponent(masteryMatch[1]);
    const mastery = String(body.mastery ?? '') as Mastery;
    const res = await app.updateCardMastery(id, mastery);
    return res.ok ? json(200, app.cards.get(id)) : json(400, { error: res.errors.join('; ') });
  }

  // POST /api/export —— 生成导出包（base64）
  if (pathname === '/api/export' && method === 'POST') {
    const notes = new Map<string, string>();
    for (const sid of new Set(app.cards.all().map(c => c.sourceId))) {
      const raw = await app.readNoteRaw(sid); // 保真读取含 front matter 的原文
      if (raw) notes.set(sid, raw);
    }
    const zip = createExportBundle({ cards: app.cards.all(), notes });
    return json(200, { base64: Buffer.from(zip).toString('base64'), bytes: zip.length });
  }

  // POST /api/import  {base64} —— 导入包
  if (pathname === '/api/import' && method === 'POST') {
    try {
      const zip = new Uint8Array(Buffer.from(String(body.base64 ?? ''), 'base64'));
      const res = importBundle(zip, app.cards);
      if (res.ok) {
        app.cards = res.store;
        app.reindexCards();
        await app.saveCards();
      }
      return json(res.ok ? 200 : 400, {
        ok: res.ok, errors: res.errors, imported: res.importedCards,
        duplicates: res.skippedDuplicates, notes: res.notesRecovered,
      });
    } catch (e) {
      return json(400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return null; // 非 API，交给静态托管
}

/** 静态文件服务：仅允许 public 目录内的文件（防目录穿越） */
async function serveStatic(pathname: string, publicDir: string): Promise<ApiResponse> {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(publicDir, safe);
  // 防穿越：解析后必须仍在 publicDir 内
  if (!filePath.startsWith(publicDir)) return json(403, { error: 'Forbidden' });
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
    const data = await readFile(filePath);
    return { status: 200, body: data, contentType: MIME[extname(filePath)] ?? 'application/octet-stream' };
  } catch {
    return json(404, { error: 'Not found' });
  }
}

/** 创建 HTTP 服务器（不启动监听） */
export function createAppServer(opts: ServerOptions): Server {
  const publicDir = opts.publicDir ?? PUBLIC_DIR;
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const method = (req.method ?? 'GET').toUpperCase();

      let response: ApiResponse;
      if (url.pathname.startsWith('/api/')) {
        const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readJson(req) : {};
        response = (await handleApi(method, url.pathname, url.searchParams, body, opts))
          ?? json(404, { error: '未知 API' });
      } else {
        response = await serveStatic(url.pathname, publicDir);
      }

      const headers: Record<string, string> = { 'Content-Type': response.contentType ?? 'application/octet-stream' };
      if (typeof response.body === 'string') {
        res.writeHead(response.status, headers);
        res.end(response.body);
      } else {
        res.writeHead(response.status, headers);
        res.end(Buffer.isBuffer(response.body) ? response.body : JSON.stringify(response.body));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
  });
}

/** 启动服务 */
export function startServer(opts: ServerOptions): Promise<Server> {
  const server = createAppServer(opts);
  return new Promise((resolve) => {
    server.listen(opts.port ?? 8765, opts.host ?? '127.0.0.1', () => resolve(server));
  });
}
