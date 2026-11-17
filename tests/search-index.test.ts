import { test, expect } from 'vitest';
import { SearchIndex, toFtsQuery } from '../src/p1/search-index.js';
import type { SharedNote, MaterialCard } from '../src/contracts/index.js';

function makeNote(sourceId: string, title: string, body: string, site = '人民日报'): SharedNote {
  return {
    sourceId,
    filePath: `library/inbox/${sourceId}-x.md`,
    front: {
      title, source_url: `https://example.com/${sourceId}`, site,
      captured_at: '2026-08-04T09:30:12+08:00', tags: ['政策理论'],
    },
    body,
    origin: { url: `https://example.com/${sourceId}`, site, author: '评论员', capturedAt: '2026-08-04T09:30:12+08:00' },
    warnings: [],
  };
}

function makeCard(cardId: string, sourceId: string, content: string, over: Partial<MaterialCard> = {}): MaterialCard {
  return {
    cardId, sourceId, type: 'golden_sentence', content,
    sourceExcerpt: `上下文：${content}`,
    excerptLoc: { para: 1, charStart: 0 },
    origin: { url: `https://example.com/${sourceId}`, site: '人民日报', author: '评论员', capturedAt: '2026-08-04T09:30:12+08:00' },
    topics: ['政策理论'], scenes: ['案例分析'], status: 'confirmed', mastery: 'new',
    extractorVersion: 'test-v1', confirmedBy: 'human', createdAt: '2026-11-17T03:00:00.000Z',
    ...over,
  };
}

test('toFtsQuery 转义引号并包成短语', () => {
  expect(toFtsQuery('基层治理')).toBe('"基层治理"');
  expect(toFtsQuery('说"实干"')).toBe('"说""实干"""');
  expect(toFtsQuery('  ')).toBe('""');
});

test('中文子串检索：笔记正文命中', () => {
  const idx = new SearchIndex();
  idx.indexNote(makeNote('20260804-093012-a1b2c3d4', '抓落实', '要提升基层治理现代化水平，持之以恒抓落实。'));
  const hits = idx.search('基层治理');
  expect(hits.length).toBe(1);
  expect(hits[0].kind).toBe('note');
  expect(hits[0].snippet).toContain('基层治理');
  idx.close();
});

test('中文检索：卡片内容命中，且区分 note/card', () => {
  const idx = new SearchIndex();
  const note = makeNote('20260804-093012-a1b2c3d4', '抓落实', '提升基层治理水平，持之以恒。');
  idx.indexNote(note);
  idx.indexCard(makeCard('card-1', note.sourceId, '基层治理是国家治理的基石。'));
  const hits = idx.search('基层治理');
  expect(hits.length).toBe(2);
  expect(hits.map(h => h.kind).sort()).toEqual(['card', 'note']);
  idx.close();
});

test('多维过滤：type / status / topics / scenes', () => {
  const idx = new SearchIndex();
  const n = makeNote('20260804-093012-a1b2c3d4', '主题', '基层治理现代化的实践探索。');
  idx.indexNote(n);
  idx.indexCards([
    makeCard('c1', n.sourceId, '基层治理金句一', { type: 'golden_sentence', status: 'confirmed', topics: ['政策理论'], scenes: ['案例分析'] }),
    makeCard('c2', n.sourceId, '基层治理标题二', { type: 'subheading', status: 'candidate', topics: ['山东实践'], scenes: ['事务性文书'] }),
  ]);

  expect(idx.search('基层治理', { kind: 'card', type: 'subheading' }).map(h => h.id)).toEqual(['c2']);
  expect(idx.search('基层治理', { kind: 'card', status: 'confirmed' }).map(h => h.id)).toEqual(['c1']);
  expect(idx.search('基层治理', { kind: 'card', topics: ['山东实践'] }).map(h => h.id)).toEqual(['c2']);
  expect(idx.search('基层治理', { kind: 'card', scenes: ['案例分析'] }).map(h => h.id)).toEqual(['c1']);
  idx.close();
});

test('增量更新：同 id 重新索引不产生副本', () => {
  const idx = new SearchIndex();
  const n1 = makeNote('20260804-093012-a1b2c3d4', '旧标题', '基层治理旧内容');
  idx.indexNote(n1);
  const n2 = { ...n1, front: { ...n1.front, title: '新标题' }, body: '基层治理新内容' };
  idx.indexNote(n2);
  expect(idx.stats().notes).toBe(1);
  expect(idx.stats().noteFts).toBe(1);
  expect(idx.getNote(n1.sourceId)?.front.title).toBe('新标题');
  expect(idx.search('新内容').length).toBe(1);
  expect(idx.search('旧内容').length).toBe(0);
  idx.close();
});

test('按来源删除：连同卡片一起清除', () => {
  const idx = new SearchIndex();
  const n = makeNote('20260804-093012-a1b2c3d4', '主题', '基层治理内容');
  idx.indexNote(n);
  idx.indexCard(makeCard('c1', n.sourceId, '基层治理卡片'));
  idx.removeSource(n.sourceId);
  expect(idx.stats().notes).toBe(0);
  expect(idx.stats().cards).toBe(0);
  expect(idx.search('基层治理').length).toBe(0);
  idx.close();
});

test('空查询按过滤条件列出全部，limit 生效', () => {
  const idx = new SearchIndex();
  const n = makeNote('20260804-093012-a1b2c3d4', '主题', '任意内容');
  idx.indexNote(n);
  idx.indexCards([
    makeCard('c1', n.sourceId, '金句一'),
    makeCard('c2', n.sourceId, '金句二', { type: 'practice' }),
  ]);
  expect(idx.search('', { kind: 'card' }).length).toBe(2);
  expect(idx.search('', { kind: 'card', type: 'practice' }).map(h => h.id)).toEqual(['c2']);
  expect(idx.search('', { kind: 'card', limit: 1 }).length).toBe(1);
  idx.close();
});

test('stats 与 clear 正确', () => {
  const idx = new SearchIndex();
  const n = makeNote('20260804-093012-a1b2c3d4', '主题', '内容');
  idx.indexNote(n);
  idx.indexCard(makeCard('c1', n.sourceId, '卡片内容'));
  expect(idx.stats()).toEqual({ notes: 1, cards: 1, noteFts: 1, cardFts: 1 });
  idx.clear();
  expect(idx.stats()).toEqual({ notes: 0, cards: 0, noteFts: 0, cardFts: 0 });
  idx.close();
});
