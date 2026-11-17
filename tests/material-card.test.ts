import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSharedNote } from '../src/p0/parse-shared-note.js';
import {
  validateCardShape,
  verifyVerbatim,
  locateExcerpt,
  originFromNote,
  createCard,
  canTransition,
  CardStore,
} from '../src/p0/material-card.js';
import type { MaterialCard, SharedNote } from '../src/contracts/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

const note: SharedNote = parseSharedNote(fixture('real-shiye-note.md'), {
  filePath: 'library/inbox/20260804-093012-a1b2c3d4-以钉钉子精神抓落实.md',
});

function makeCard(overrides: Partial<MaterialCard> = {}): MaterialCard {
  const base = createCard(
    {
      sourceId: note.sourceId,
      type: 'golden_sentence',
      content: '抓落实，贵在持之以恒，要有钉钉子精神',
      sourceExcerpt: '抓落实，是党的路线方针政策转化为实际行动的关键环节。抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。',
      excerptLoc: locateExcerpt('抓落实，贵在持之以恒，要有钉钉子精神', note.body),
      origin: originFromNote(note),
      topics: ['政策理论'],
    },
    note,
  );
  return { ...base, ...overrides };
}

describe('verifyVerbatim — 逐字约束（防误引底线）', () => {
  it('原文逐字子串通过', () => {
    expect(verifyVerbatim('抓落实，贵在持之以恒', note.body).ok).toBe(true);
  });

  it('改写过的句子被拒绝', () => {
    const r = verifyVerbatim('抓落实贵在坚持不懈', note.body);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('逐字子串');
  });

  it('编造的金句被拒绝', () => {
    expect(verifyVerbatim('这是原文里根本没有的金句', note.body).ok).toBe(false);
  });
});

describe('validateCardShape — 字段完整性', () => {
  it('合法卡片通过', () => {
    expect(validateCardShape(makeCard()).ok).toBe(true);
  });

  it('缺出处 url 被拒绝', () => {
    const card = makeCard();
    card.origin.url = '';
    const r = validateCardShape(card);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('origin.url'))).toBe(true);
  });

  it('缺原文片段被拒绝', () => {
    const card = makeCard({ sourceExcerpt: '' });
    expect(validateCardShape(card).ok).toBe(false);
  });
});

describe('locateExcerpt — 原文定位', () => {
  it('返回段落号与字符偏移', () => {
    const loc = locateExcerpt('抓落实，贵在持之以恒', note.body);
    expect(loc.charStart).toBeGreaterThan(0);
    expect(loc.para).toBeGreaterThanOrEqual(1);
  });
});

describe('originFromNote — 出处派生（只读）', () => {
  it('从拾页笔记派生完整出处', () => {
    const origin = originFromNote(note);
    expect(origin.site).toBe('人民日报');
    expect(origin.url).toContain('paper.people.com.cn');
    expect(origin.capturedAt).toBe('2026-08-04T09:30:12+08:00');
  });
});

describe('canTransition — 状态机', () => {
  it('允许 candidate → confirmed', () => {
    expect(canTransition('candidate', 'confirmed')).toBe(true);
  });
  it('拒绝 unprocessed → used（跳过中间态）', () => {
    expect(canTransition('unprocessed', 'used')).toBe(false);
  });
  it('拒绝非法状态值', () => {
    expect(canTransition('candidate', 'bogus' as never)).toBe(false);
  });
});

describe('CardStore — JSONL 存储', () => {
  it('add 成功并通过逐字+出处校验', () => {
    const store = new CardStore();
    expect(store.add(makeCard(), note.body).ok).toBe(true);
    expect(store.size).toBe(1);
  });

  it('拒绝逐字不一致的卡片', () => {
    const store = new CardStore();
    const card = makeCard({ content: '编造的内容' });
    expect(store.add(card, note.body).ok).toBe(false);
    expect(store.size).toBe(0);
  });

  it('拒绝重复卡片（同原文同内容）', () => {
    const store = new CardStore();
    store.add(makeCard(), note.body);
    const dup = makeCard(); // 内容相同
    const r = store.add(dup, note.body);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('重复');
    expect(store.size).toBe(1);
  });

  it('状态转换与掌握度更新', () => {
    const store = new CardStore();
    const card = makeCard();
    store.add(card, note.body);
    expect(store.updateStatus(card.cardId, 'confirmed').ok).toBe(true);
    expect(store.byStatus('confirmed')).toHaveLength(1);
    expect(store.updateMastery(card.cardId, 'mastered').ok).toBe(true);
    expect(store.all()[0].mastery).toBe('mastered');
  });

  it('非法状态转换被拒绝', () => {
    const store = new CardStore();
    const card = makeCard();
    store.add(card, note.body);
    expect(store.updateStatus(card.cardId, 'used').ok).toBe(false);
  });

  it('JSONL 往返无损', () => {
    const store = new CardStore();
    store.add(makeCard(), note.body);
    store.add(makeCard({ content: '一锤接着一锤敲', type: 'subheading' }), note.body);
    const jsonl = store.toJSONL();
    const restored = CardStore.fromJSONL(jsonl);
    expect(restored.size).toBe(2);
    expect(restored.all().map((c) => c.content).sort()).toEqual(
      store.all().map((c) => c.content).sort(),
    );
  });

  it('fromJSONL 跳过损坏行不中断', () => {
    const good = JSON.stringify(makeCard());
    const store = CardStore.fromJSONL(`{broken json\n${good}\n`);
    expect(store.size).toBe(1);
  });
});
