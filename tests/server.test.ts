import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { AppState } from '../src/p2/app-state.js';
import { startServer } from '../src/p2/server.js';

const NOTE = `---
title: 抓落实
source_url: https://example.com/a1b2c3d4
site: 人民日报
captured_at: 2026-08-04T09:30:12+08:00
tags: [政策理论]
content_hash: a1b2c3d4
---

## 抓落实，贵在持之以恒

抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。基层治理现代化需要久久为功。
`;

let root: string;
let app: AppState;
let server: Server;
let base: string;

async function api(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yantian-api-'));
  await mkdir(join(root, 'library', 'inbox'), { recursive: true });
  await writeFile(join(root, 'library', 'inbox', '20260804-093012-a1b2c3d4-ding.md'), NOTE, 'utf-8');
  app = await AppState.open(root);
  server = await startServer({ app, port: 0 }); // 0 = 系统分配端口
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  app.close();
  await rm(root, { recursive: true, force: true });
});

test('GET /api/health', async () => {
  const r = await api('/api/health');
  expect(r.status).toBe(200);
  expect((r.data as { ok: boolean }).ok).toBe(true);
});

test('扫描 → 检索 → 统计 全链路 API', async () => {
  const scan = await api('/api/scan', 'POST');
  expect(scan.status).toBe(200);
  expect((scan.data as { added: number }).added).toBe(1);

  const search = await api('/api/search?q=' + encodeURIComponent('钉钉子精神'));
  expect(search.status).toBe(200);
  expect((search.data as { total: number }).total).toBeGreaterThanOrEqual(1);

  const stats = await api('/api/stats');
  expect((stats.data as { notes: number }).notes).toBe(1);
});

test('手动导入 → 抽取 → 确认 → 复习 全流程', async () => {
  await api('/api/scan', 'POST');

  // 手动导入
  const created = await api('/api/cards/manual', 'POST', {
    sourceId: '20260804-093012-a1b2c3d4', content: '要有钉钉子精神',
    type: 'golden_sentence', topics: ['政策理论'], scenes: ['案例分析'],
  });
  expect(created.status).toBe(201);
  const cid = (created.data as { cardId: string }).cardId;

  // 确认状态：candidate → confirmed
  const confirmed = await api(`/api/cards/${cid}/status`, 'PATCH', { status: 'confirmed' });
  expect(confirmed.status).toBe(200);

  // 抽取候选（规则抽取）
  const ext = await api('/api/extract', 'POST', { sourceId: '20260804-093012-a1b2c3d4' });
  expect(ext.status).toBe(200);
  expect((ext.data as { candidates: unknown[] }).candidates.length).toBeGreaterThan(0);

  // 复习卡（只收已确认）
  const review = await api('/api/review');
  expect((review.data as unknown[]).length).toBe(1);
  expect(((review.data as Array<{ back: string }>)[0].back)).toBe('要有钉钉子精神');
});

test('写作台主题包 API', async () => {
  await api('/api/scan', 'POST');
  await api('/api/cards/manual', 'POST', {
    sourceId: '20260804-093012-a1b2c3d4', content: '要有钉钉子精神',
    type: 'golden_sentence', topics: ['政策理论'],
  });
  const bundle = await api('/api/bundle?topic=' + encodeURIComponent('政策理论'));
  const b = bundle.data as { total: number; golden_sentence_cited: string[] };
  expect(b.total).toBe(1);
  expect(b.golden_sentence_cited[0]).toContain('人民日报');
});

test('导出→导入 API 往返（保真 front matter）', async () => {
  await api('/api/scan', 'POST');
  await api('/api/cards/manual', 'POST', {
    sourceId: '20260804-093012-a1b2c3d4', content: '要有钉钉子精神', type: 'golden_sentence',
  });
  const exp = await api('/api/export', 'POST');
  expect(exp.status).toBe(200);
  const b64 = (exp.data as { base64: string }).base64;
  expect(b64.length).toBeGreaterThan(0);

  // 清空后导入
  app.cards = new (await import('../src/p0/material-card.js')).CardStore();
  const imp = await api('/api/import', 'POST', { base64: b64 });
  expect(imp.status).toBe(200);
  expect((imp.data as { imported: number }).imported).toBe(1);
  expect((imp.data as { notes: number }).notes).toBe(1);
});

test('非法状态转换被拒绝', async () => {
  await api('/api/scan', 'POST');
  const created = await api('/api/cards/manual', 'POST', {
    sourceId: '20260804-093012-a1b2c3d4', content: '要有钉钉子精神', type: 'golden_sentence',
  });
  const cid = (created.data as { cardId: string }).cardId;
  // candidate → used 非法
  const bad = await api(`/api/cards/${cid}/status`, 'PATCH', { status: 'used' });
  expect(bad.status).toBe(400);
});
