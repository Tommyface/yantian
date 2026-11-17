import { test, expect } from 'vitest';
import {
  RuleExtractor, OllamaExtractor, FallbackExtractor, buildCandidates,
  type Extractor,
} from '../src/p2/extractor.js';
import type { SharedNote } from '../src/contracts/index.js';

const BODY = `## 抓落实，贵在持之以恒

抓落实，是党的路线方针政策转化为实际行动的关键环节。抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。

基层治理现代化需要久久为功，要把各项决策部署落到实处，确保落地见效。`;

function note(): SharedNote {
  return {
    sourceId: '20260804-093012-a1b2c3d4',
    filePath: 'library/inbox/a.md',
    front: { title: '抓落实', source_url: 'https://example.com/a', site: '人民日报', captured_at: '2026-08-04T09:30:12+08:00' },
    body: BODY,
    origin: { url: 'https://example.com/a', site: '人民日报', author: '', capturedAt: '2026-08-04T09:30:12+08:00' },
    warnings: [],
  };
}

test('buildCandidates：逐字子串保留，编造片段被丢弃', () => {
  const r = buildCandidates(note(), [
    { text: '要有钉钉子精神', type: 'golden_sentence', confidence: 0.9 },
    { text: '这是AI编造的句子并不是原文', type: 'golden_sentence', confidence: 0.99 },
    { text: '抓落实，贵在持之以恒', type: 'subheading', confidence: 0.8 },
  ]);
  expect(r.candidates).toHaveLength(2);
  expect(r.rejected).toBe(1);
  expect(r.candidates.every(c => BODY.includes(c.content))).toBe(true);
  // 置信度降序
  expect(r.candidates[0].confidence).toBeGreaterThanOrEqual(r.candidates[1].confidence);
  expect(r.candidates[0].excerptLoc.charStart).toBeGreaterThanOrEqual(0);
  expect(r.candidates[0].sourceExcerpt.length).toBeGreaterThan(0);
});

test('RuleExtractor：抽出小标题与金句，且全部逐字一致', async () => {
  const r = await new RuleExtractor().extract(note());
  expect(r.extractor).toBe('rule-local-v1');
  expect(r.candidates.some(c => c.type === 'subheading')).toBe(true);
  expect(r.candidates.some(c => c.type === 'golden_sentence')).toBe(true);
  expect(r.candidates.every(c => BODY.includes(c.content))).toBe(true);
});

test('RuleExtractor：无信号词的普通文本不强行抽金句', async () => {
  const n = note();
  n.body = '今天天气不错。我们去了公园。';
  const r = await new RuleExtractor().extract(n);
  expect(r.candidates.filter(c => c.type === 'golden_sentence')).toHaveLength(0);
});

test('OllamaExtractor：注入 fetcher 模拟本地模型，逐字校验生效', async () => {
  const fakeFetcher = async (_url: string, _init: RequestInit) => ({
    ok: true,
    text: async () => JSON.stringify({
      response: JSON.stringify([
        { text: '要有钉钉子精神', type: 'golden_sentence' },
        { text: '编造内容绝不存在', type: 'golden_sentence' },
      ]),
    }),
  });
  const ext = new OllamaExtractor({ model: 'test-model', fetcher: fakeFetcher });
  const r = await ext.extract(note());
  expect(r.extractor).toContain('ollama-test-model');
  expect(r.candidates).toHaveLength(1);
  expect(r.rejected).toBe(1);
});

test('OllamaExtractor：模型不可用抛错', async () => {
  const badFetcher = async () => ({ ok: false, text: async () => '' });
  const ext = new OllamaExtractor({ fetcher: badFetcher });
  await expect(ext.extract(note())).rejects.toThrow();
});

test('FallbackExtractor：主后端失败时回退规则抽取', async () => {
  const broken: Extractor = {
    name: 'broken',
    extract: async () => { throw new Error('model down'); },
  };
  const fb = new FallbackExtractor(broken);
  const n = note();
  const r = await fb.extract(n);
  expect(r.extractor).toContain('fallback');
  expect(r.candidates.length).toBeGreaterThan(0);
  expect(r.candidates.every(c => n.body.includes(c.content))).toBe(true);
});
