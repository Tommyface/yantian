import { test, expect } from 'vitest';
import { buildTopicBundle, listTopicSummaries, buildReviewDeck, orderReviewDeck, toCitation } from '../src/p2/review.js';
import type { MaterialCard } from '../src/contracts/index.js';

function card(over: Partial<MaterialCard> = {}): MaterialCard {
  return {
    cardId: Math.random().toString(36).slice(2), sourceId: 's1', type: 'golden_sentence',
    content: '抓落实，贵在持之以恒', sourceExcerpt: '原文片段', excerptLoc: { para: 1, charStart: 0 },
    origin: { url: 'https://example.com/a', site: '人民日报', author: '评论员', capturedAt: '2026-08-04T09:30:12+08:00' },
    topics: ['政策理论'], scenes: ['案例分析'], status: 'confirmed', mastery: 'new',
    extractorVersion: 't', confirmedBy: 'human', createdAt: '2026-11-17T03:00:00.000Z',
    ...over,
  };
}

test('buildTopicBundle：按主题聚合，分类归组', () => {
  const cards = [
    card({ type: 'golden_sentence', topics: ['政策理论'] }),
    card({ type: 'subheading', topics: ['政策理论'] }),
    card({ type: 'practice', topics: ['山东实践'] }),
  ];
  const b = buildTopicBundle(cards, '政策理论');
  expect(b.total).toBe(2);
  expect(b.golden_sentence).toHaveLength(1);
  expect(b.subheading).toHaveLength(1);
  expect(b.practice).toHaveLength(0);

  const all = buildTopicBundle(cards);
  expect(all.total).toBe(3);
});

test('listTopicSummaries：内置主题齐全 + 按数量排序', () => {
  const cards = [
    card({ topics: ['山东实践'] }),
    card({ topics: ['山东实践'] }),
    card({ topics: ['文字表达'] }),
  ];
  const s = listTopicSummaries(cards);
  expect(s.length).toBeGreaterThanOrEqual(4);
  expect(s[0].topic).toBe('山东实践');
  expect(s[0].count).toBe(2);
  expect(s.find(x => x.topic === '综合分析')).toBeDefined();
});

test('buildReviewDeck：只收已确认素材，未确认排除', () => {
  const deck = buildReviewDeck([
    card({ status: 'confirmed', content: '确认金句' }),
    card({ status: 'used', content: '已用金句' }),
    card({ status: 'candidate', content: '未确认候选' }),
  ]);
  expect(deck).toHaveLength(2);
  expect(deck.some(d => d.back === '未确认候选')).toBe(false);
  expect(deck[0].originText).toContain('人民日报');
  expect(deck[0].front).toContain('金句');
});

test('orderReviewDeck：待巩固优先，已掌握靠后', () => {
  const deck = buildReviewDeck([
    card({ mastery: 'mastered', content: '已掌握' }),
    card({ mastery: 'new', content: '新素材' }),
    card({ mastery: 'reviewing', content: '复习中' }),
  ]);
  const ordered = orderReviewDeck(deck);
  expect(ordered.map(d => d.back)).toEqual(['新素材', '复习中', '已掌握']);
});

test('toCitation：生成含出处的可引用文本', () => {
  const text = toCitation(card());
  expect(text).toContain('抓落实，贵在持之以恒');
  expect(text).toContain('人民日报');
  expect(text).toContain('https://example.com/a');
});
