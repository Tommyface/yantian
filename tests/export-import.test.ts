import { test, expect } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createExportBundle, importBundle, manualImport } from '../src/p1/export-import.js';
import { CardStore } from '../src/p0/material-card.js';
import type { SharedNote, MaterialCard } from '../src/contracts/index.js';

const RAW = `---
title: 抓落实
source_url: https://example.com/a1b2c3d4
site: 人民日报
captured_at: 2026-08-04T09:30:12+08:00
tags: [政策理论]
content_hash: a1b2c3d4
---

抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。基层治理现代化需要久久为功。
`;

function note(): SharedNote {
  return {
    sourceId: '20260804-093012-a1b2c3d4',
    filePath: 'library/inbox/a.md',
    front: { title: '抓落实', source_url: 'https://example.com/a1b2c3d4', site: '人民日报', captured_at: '2026-08-04T09:30:12+08:00', tags: ['政策理论'] },
    body: '抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。基层治理现代化需要久久为功。',
    origin: { url: 'https://example.com/a1b2c3d4', site: '人民日报', author: '', capturedAt: '2026-08-04T09:30:12+08:00' },
    warnings: [],
  };
}

function card(): MaterialCard {
  return {
    cardId: 'card-uuid-1', sourceId: '20260804-093012-a1b2c3d4', type: 'golden_sentence',
    content: '抓落实，贵在持之以恒，要有钉钉子精神',
    sourceExcerpt: '抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。',
    excerptLoc: { para: 1, charStart: 0 },
    origin: { url: 'https://example.com/a1b2c3d4', site: '人民日报', author: '', capturedAt: '2026-08-04T09:30:12+08:00' },
    topics: ['政策理论'], scenes: ['案例分析'], status: 'confirmed', mastery: 'new',
    extractorVersion: 'test-v1', confirmedBy: 'human', createdAt: '2026-11-17T03:00:00.000Z',
  };
}

test('导出→导入完整往返：卡片与原文恢复', () => {
  const n = note();
  const zip = createExportBundle({ cards: [card()], notes: new Map([[n.sourceId, RAW]]) });
  const report = importBundle(zip, new CardStore());
  expect(report.ok).toBe(true);
  expect(report.importedCards).toBe(1);
  expect(report.notesRecovered).toBe(1);
  expect(report.store.size).toBe(1);
  expect(report.store.all()[0].content).toContain('钉钉子精神');
});

test('幂等：同一包导入两次，第二次全部跳过', () => {
  const n = note();
  const zip = createExportBundle({ cards: [card()], notes: new Map([[n.sourceId, RAW]]) });
  const first = importBundle(zip, new CardStore());
  const second = importBundle(zip, first.store);
  expect(second.ok).toBe(true);
  expect(second.importedCards).toBe(0);
  expect(second.skippedDuplicates).toBe(1);
  expect(second.store.size).toBe(1);
});

test('篡改检测：修改 zip 内 manifest 校验值即拒绝', () => {
  const n = note();
  const zip = createExportBundle({ cards: [card()], notes: new Map([[n.sourceId, RAW]]) });
  // 用 fflate 解包，篡改 cards.jsonl，重新打包（manifest 未更新 → SHA256 不符）
  const files = unzipSync(zip);
  files['cards.jsonl'] = strToU8(strFromU8(files['cards.jsonl']).replace('钉钉子精神', '钉钉子态度'));
  const tampered = zipSync(files);
  const report = importBundle(tampered, new CardStore());
  expect(report.ok).toBe(false);
  expect(report.errors.some(e => e.includes('SHA256'))).toBe(true);
});

test('逐字约束：卡片内容不在原文中则拒绝', () => {
  const bad = { ...card(), content: '这是编造的金句，原文根本没有' };
  const n = note();
  // 直接构造包（绕过 createExportBundle 的约束，模拟恶意包）：用正常包再篡改卡片并同步 manifest
  const zip = createExportBundle({ cards: [bad], notes: new Map([[n.sourceId, RAW]]) });
  const report = importBundle(zip, new CardStore());
  expect(report.ok).toBe(false);
  expect(report.errors.some(e => e.includes('逐字'))).toBe(true);
  expect(report.store.size).toBe(0);
});

test('手动导入：原文子串成功，编造内容被拒', () => {
  const n = note();
  const ok = manualImport({ note: n, type: 'golden_sentence', content: '要有钉钉子精神' });
  expect(ok.ok).toBe(true);
  expect(ok.card?.content).toBe('要有钉钉子精神');
  expect(ok.card?.status).toBe('candidate');

  const bad = manualImport({ note: n, type: 'golden_sentence', content: '凭空捏造的句子' });
  expect(bad.ok).toBe(false);
  expect(bad.errors.some(e => e.includes('逐字'))).toBe(true);
});

test('缺原文的卡片：仍可入库但仅做 shape + 出处校验', () => {
  const zip = createExportBundle({ cards: [card()], notes: new Map() });
  const report = importBundle(zip, new CardStore());
  expect(report.ok).toBe(true);
  expect(report.importedCards).toBe(1);
  expect(report.notesRecovered).toBe(0);
});
