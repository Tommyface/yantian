import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppState, defaultPaths, isVaultReady } from '../src/p2/app-state.js';
import { createCard, originFromNote } from '../src/p0/material-card.js';
import { manualImport } from '../src/p1/export-import.js';
import type { SharedNote, MaterialCard } from '../src/contracts/index.js';

const NOTE = `---
title: 抓落实
source_url: https://example.com/a1b2c3d4
site: 人民日报
captured_at: 2026-08-04T09:30:12+08:00
tags: [政策理论]
content_hash: a1b2c3d4
---

抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。基层治理现代化需要久久为功。
`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yantian-state-'));
  await mkdir(join(root, 'library', 'inbox'), { recursive: true });
  await writeFile(join(root, 'library', 'inbox', '20260804-093012-a1b2c3d4-ding.md'), NOTE, 'utf-8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function sampleNote(): SharedNote {
  return {
    sourceId: '20260804-093012-a1b2c3d4',
    filePath: 'library/inbox/a.md',
    front: { title: '抓落实', source_url: 'https://example.com/a1b2c3d4', site: '人民日报', captured_at: '2026-08-04T09:30:12+08:00', tags: ['政策理论'] },
    body: '抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。基层治理现代化需要久久为功。',
    origin: { url: 'https://example.com/a1b2c3d4', site: '人民日报', author: '', capturedAt: '2026-08-04T09:30:12+08:00' },
    warnings: [],
  };
}

test('defaultPaths 与 isVaultReady', () => {
  const p = defaultPaths(root);
  expect(p.cardsPath).toContain('.yantian/cards.jsonl');
  expect(p.indexPath).toContain('.yantian/index.sqlite');
  expect(isVaultReady(root)).toBe(true);
  expect(isVaultReady(join(root, 'nonexistent'))).toBe(false);
});

test('新建 AppState：空卡片，索引为空', async () => {
  const app = await AppState.open(root);
  expect(app.cards.size).toBe(0);
  expect(app.stats().cards).toBe(0);
  app.close();
});

test('syncFromVault：扫描并把笔记纳入索引', async () => {
  const app = await AppState.open(root);
  const report = await app.syncFromVault();
  expect(report.added).toBe(1);
  expect(app.stats().notes).toBe(1);
  expect(app.search('钉钉子精神').some(h => h.kind === 'note')).toBe(true);
  app.close();
});

test('addCard：卡片落事实源 + 索引，重启后仍在', async () => {
  const app = await AppState.open(root);
  await app.syncFromVault();
  const note = sampleNote();
  const mi = manualImport({ note, type: 'golden_sentence', content: '要有钉钉子精神', topics: ['政策理论'], scenes: ['案例分析'] });
  const res = await app.addCard(mi.card!, note.body);
  expect(res.ok).toBe(true);
  expect(app.stats().cards).toBe(1);

  // jsonl 已落盘
  const disk = await readFile(defaultPaths(root).cardsPath, 'utf-8');
  expect(disk).toContain('要有钉钉子精神');

  // 关闭重开：卡片与索引都在
  app.close();
  const app2 = await AppState.open(root);
  expect(app2.cards.size).toBe(1);
  expect(app2.search('钉钉子精神').some(h => h.kind === 'card')).toBe(true);
  app2.close();
});

test('索引被删后重启：从卡片事实源自动回填', async () => {
  const app = await AppState.open(root);
  const note = sampleNote();
  const mi = manualImport({ note, type: 'golden_sentence', content: '要有钉钉子精神' });
  await app.addCard(mi.card!, note.body);
  app.close();

  // 删除索引文件，模拟索引丢失
  const { rm: rmFile } = await import('node:fs/promises');
  await rmFile(defaultPaths(root).indexPath, { force: true });
  const app2 = await AppState.open(root);
  expect(app2.stats().cards).toBe(1);
  expect(app2.search('钉钉子精神').length).toBeGreaterThanOrEqual(1);
  app2.close();
});

test('状态与掌握度更新：事实源 + 索引同步', async () => {
  const app = await AppState.open(root);
  const note = sampleNote();
  const mi = manualImport({ note, type: 'golden_sentence', content: '要有钉钉子精神' });
  await app.addCard(mi.card!, note.body);
  const cid = mi.card!.cardId;

  expect((await app.updateCardStatus(cid, 'confirmed')).ok).toBe(true);
  expect(app.cards.get(cid)?.status).toBe('confirmed');
  // candidate → confirmed 合法；再 confirmed→used
  expect((await app.updateCardStatus(cid, 'used')).ok).toBe(true);
  expect((await app.updateCardMastery(cid, 'mastered')).ok).toBe(true);
  expect(app.cards.get(cid)?.mastery).toBe('mastered');
  // 索引里同步了掌握度
  expect(app.index.getCard(cid)?.mastery).toBe('mastered');
  app.close();
});

test('统计：按状态/类型/主题分布', async () => {
  const app = await AppState.open(root);
  const note = sampleNote();
  const c1 = manualImport({ note, type: 'golden_sentence', content: '要有钉钉子精神', topics: ['政策理论'] }).card!;
  const c2 = manualImport({ note, type: 'subheading', content: '抓落实，贵在持之以恒', topics: ['文字表达'] }).card!;
  await app.addCard(c1, note.body);
  await app.addCard(c2, note.body);

  const s = app.stats();
  expect(s.byType['golden_sentence']).toBe(1);
  expect(s.byType['subheading']).toBe(1);
  expect(s.byTopic['政策理论']).toBe(1);
  expect(s.byStatus['candidate']).toBe(2);
  app.close();
});
