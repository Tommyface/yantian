import { test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanVault, changedNotes } from '../src/p1/vault-scanner.js';
import { SearchIndex } from '../src/p1/search-index.js';
import { manualImport, createExportBundle, importBundle } from '../src/p1/export-import.js';
import { CardStore } from '../src/p0/material-card.js';

/**
 * 端到端：拾页原文 → 扫描 → 手动导入卡片 → FTS5 索引 → 检索 → 导出包 → 再导入。
 * 验证 P1 全链路与 P0 契约层无缝衔接。
 */

const NOTE = `---
title: 以钉钉子精神抓落实
source_url: http://paper.people.com.cn/rmrb/pc/content/202608/04/content_12345.html
source_type: web
site: 人民日报
author: 本报评论员
captured_at: 2026-08-04T09:30:12+08:00
category: inbox
tags: [政策理论, 作风建设, 抓落实]
status: inbox
content_hash: a1b2c3d4
quality: clean
ocr: none
warnings: []
---

## 抓落实，贵在持之以恒

抓落实，是党的路线方针政策转化为实际行动的关键环节。抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。

基层治理现代化需要久久为功，把各项决策部署落到实处。
`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'yantian-e2e-'));
  await mkdir(join(root, 'library', 'inbox'), { recursive: true });
  await writeFile(join(root, 'library', 'inbox', '20260804-093012-a1b2c3d4-ding.md'), NOTE, 'utf-8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('P1 全链路：扫描→导入→索引→检索→导出→再导入', async () => {
  // 1. 扫描拾页库
  const report = await scanVault({ vaultRoot: root });
  expect(report.added).toBe(1);
  const notes = changedNotes(report);
  expect(notes).toHaveLength(1);
  const note = notes[0];
  expect(note.front.site).toBe('人民日报');
  expect(note.origin.url).toContain('paper.people.com.cn');

  // 2. 手动导入一张金句卡片（逐字约束生效）
  const mi = manualImport({
    note, type: 'golden_sentence',
    content: '抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲',
    topics: ['政策理论'], scenes: ['案例分析'],
  });
  expect(mi.ok).toBe(true);
  const card = mi.card!;
  expect(card.status).toBe('candidate');
  expect(card.origin.url).toBe(note.origin.url);

  // 3. 入库（CardStore 校验逐字 + 出处）
  const store = new CardStore();
  const add = store.add(card, note.body);
  expect(add.ok).toBe(true);

  // 4. 索引笔记 + 卡片
  const idx = new SearchIndex();
  idx.indexNote(note);
  idx.indexCards(store.all());

  // 5. 中文子串检索，双类型召回
  const hits = idx.search('钉钉子精神');
  expect(hits.length).toBeGreaterThanOrEqual(2);
  expect(hits.some(h => h.kind === 'note')).toBe(true);
  expect(hits.some(h => h.kind === 'card')).toBe(true);

  // 6. 多维过滤
  const filtered = idx.search('抓落实', { kind: 'card', topics: ['政策理论'], status: 'candidate' });
  expect(filtered).toHaveLength(1);

  // 7. 导出包
  const zip = createExportBundle({ cards: store.all(), notes: new Map([[note.sourceId, NOTE]]) });

  // 8. 导入到新库（模拟换设备）
  const reimport = importBundle(zip, new CardStore());
  expect(reimport.ok).toBe(true);
  expect(reimport.importedCards).toBe(1);
  expect(reimport.notesRecovered).toBe(1);

  // 9. 再次导入幂等
  const again = importBundle(zip, reimport.store);
  expect(again.skippedDuplicates).toBe(1);
  expect(again.store.size).toBe(1);

  idx.close();
});
