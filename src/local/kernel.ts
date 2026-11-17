// 砚田本地内核（浏览器/Capacitor 通用，纯 TS，离线可用）
// 移植自 yantian/src/p0~p2，行为对齐桌面端：
//  - 事实源：md（front matter）+ 卡片 JSONL（此处持久化到 KV）
//  - 逐字校验：候选必须是原文子串，杜绝编造
//  - 检索：中文子串/短语匹配（数据量小，毫秒级；比 trigram 对小中文更友好）

import type {
  SharedNote, MaterialCard, ExamTopic, MaterialType, CompileStatus, Mastery,
  AppStats, TopicSummary, TopicBundle, ReviewCard, SearchResult, SearchHit,
  ExtractionResult, CardOrigin,
} from '../types';
import { kv, noteStore, type StoredNote } from './store';

// ---------- 常量 ----------
export const EXAM_TOPICS: ExamTopic[] = ['政策理论', '综合分析', '文字表达', '山东实践'];
const MATERIAL_TYPES: MaterialType[] = ['golden_sentence', 'subheading', 'practice', 'article'];
const CARDS_KEY = 'cards';

const TYPE_LABEL: Record<MaterialType, string> = {
  golden_sentence: '金句', subheading: '小标题', practice: '改革实践', article: '好文章',
};

// ---------- front matter 解析（轻量 YAML，avoid 时间漂移） ----------
function parseFrontMatter(raw: string): { front: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { front: {}, body: raw };
  const front: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_\-]+):\s*(.*)$/);
    if (!mm) continue;
    let [, k, v] = mm;
    v = v.trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      front[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else {
      front[k] = v.replace(/^['"]|['"]$/g, '');
    }
  }
  return { front, body: m[2] };
}

function newSourceId(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const rand = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  return `${stamp}-${rand}`;
}

/** 把一份 md 原文解析为 SharedNote */
export function toSharedNote(stored: StoredNote): SharedNote {
  const { front, body } = parseFrontMatter(stored.raw);
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  const origin: CardOrigin = {
    url: String(front.source_url ?? ''),
    site: String(front.site ?? ''),
    author: String(front.author ?? ''),
    capturedAt: String(front.captured_at ?? stored.createdAt),
  };
  return {
    sourceId: stored.sourceId,
    filePath: stored.filePath,
    body,
    front: {
      title: front.title ? String(front.title) : undefined,
      source_url: front.source_url ? String(front.source_url) : undefined,
      site: front.site ? String(front.site) : undefined,
      author: front.author ? String(front.author) : undefined,
      captured_at: front.captured_at ? String(front.captured_at) : undefined,
      tags: arr(front.tags),
    },
    origin,
    warnings: [],
  };
}

/** 新增/更新一篇笔记（传入标题、正文、来源等，生成拾页格式 md） */
export async function upsertNote(input: {
  sourceId?: string; title: string; body: string; site?: string; author?: string; url?: string; tags?: string[];
}): Promise<SharedNote> {
  const sourceId = input.sourceId || newSourceId();
  const now = new Date().toISOString();
  const esc = (s: string) => s.replace(/\r?\n/g, ' ');
  const tags = (input.tags || []).map(t => `  - ${esc(t)}`).join('\n');
  const raw = [
    '---',
    `title: ${esc(input.title)}`,
    `source_url: ${esc(input.url || '')}`,
    `site: ${esc(input.site || '')}`,
    `author: ${esc(input.author || '')}`,
    `captured_at: ${now}`,
    'tags:',
    ...((input.tags || []).length ? [tags] : []),
    '---',
    '',
    input.body,
  ].join('\n');
  const stored: StoredNote = {
    sourceId,
    filePath: `library/${sourceId}.md`,
    raw,
    createdAt: now,
  };
  await noteStore.save(stored);
  return toSharedNote(stored);
}

// ---------- 抽取器（逐字校验） ----------
const SENT_END = /[。！？!?；;]/;
const GOLDEN_SIGNALS = [
  '贵在', '关键在于', '根本在于', '必须', '就是', '不是', '只有', '才能',
  '既要', '又要', '一锤', '久久为功', '持之以恒', '基石', '根本', '核心',
  '关键', '主旋律', '抓手', '落脚点',
];

export async function extract(sourceId: string): Promise<ExtractionResult> {
  const stored = await noteStore.get(sourceId);
  if (!stored) throw new Error(`未找到笔记 ${sourceId}`);
  const note = toSharedNote(stored);
  const raw: Array<{ text: string; type: MaterialType; confidence: number }> = [];

  // 小标题
  for (const line of note.body.split('\n')) {
    const t = line.trim();
    const m = t.match(/^#{2,3}\s+(.+)$/);
    const cn = t.match(/^[一二三四五六七八九十]+、\s*(.+)$/);
    const title = m?.[1] ?? cn?.[1];
    if (title && title.length >= 4 && title.length <= 30) {
      raw.push({ text: title, type: 'subheading', confidence: 0.8 });
    }
  }
  // 金句
  const sentences = note.body.split(/\n\s*\n/).flatMap(p => p.split(/(?<=[。！？!?；;])/)).map(s => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const clean = s.replace(/^[#>\-\*\d\.\s]+/, '');
    if (clean.length < 12 || clean.length > 120 || !SENT_END.test(clean)) continue;
    let score = 0.3;
    const hits = GOLDEN_SIGNALS.filter(w => clean.includes(w));
    score += Math.min(hits.length * 0.12, 0.45);
    if (clean.includes('，')) score += 0.1;
    if (clean.length >= 20 && clean.length <= 60) score += 0.1;
    if (score >= 0.45) raw.push({ text: s, type: 'golden_sentence', confidence: Math.min(score, 0.99) });
  }

  // 逐字校验 + 位置/上下文
  const candidates: ExtractionResult['candidates'] = [];
  let rejected = 0;
  for (const item of raw) {
    const text = item.text.trim();
    if (!text) continue;
    const at = note.body.indexOf(text);
    if (at < 0) { rejected++; continue; } // 非原文子串 → 丢弃
    candidates.push({
      text, type: item.type, confidence: item.confidence, verbatim: true, sourceId,
    });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return { sourceId, candidates, dropped: rejected };
}

// ---------- 卡片管理 ----------
async function allCards(): Promise<MaterialCard[]> { return kv.get<MaterialCard[]>(CARDS_KEY, []); }
async function saveCards(cards: MaterialCard[]): Promise<void> { await kv.set(CARDS_KEY, cards); }
export { allCards as cards };

function tagsToTopics(tags: string[]): ExamTopic[] {
  const map: Record<string, ExamTopic> = {
    '政策理论': '政策理论', '综合分析': '综合分析', '文字表达': '文字表达', '山东实践': '山东实践',
    '金句': '文字表达', '小标题': '文字表达', '山东': '山东实践', '改革': '山东实践',
  };
  const out = new Set<ExamTopic>();
  for (const t of tags) if (map[t]) out.add(map[t]);
  return out.size ? [...out] : ['综合分析'];
}

export async function addCard(input: {
  sourceId: string; content: string; type: string; topics?: string[]; scenes?: string[];
  confirm?: boolean;
}): Promise<MaterialCard> {
  const stored = await noteStore.get(input.sourceId);
  if (!stored) throw new Error(`未找到原文 ${input.sourceId}，无法逐字校验`);
  const note = toSharedNote(stored);
  // 逐字校验：卡片内容必须是原文子串
  if (note.body.indexOf(input.content.trim()) < 0) {
    throw new Error('逐字校验未通过：内容不是原文片段');
  }
  const cards = await allCards();
  const dup = cards.find(c => c.sourceId === input.sourceId && c.content === input.content.trim());
  if (dup) return dup; // 幂等去重

  const type = (MATERIAL_TYPES.includes(input.type as MaterialType) ? input.type : 'golden_sentence') as MaterialType;
  const card: MaterialCard = {
    cardId: `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    sourceId: input.sourceId,
    type,
    content: input.content.trim(),
    sourceExcerpt: note.body.slice(Math.max(0, note.body.indexOf(input.content.trim()) - 40), note.body.indexOf(input.content.trim()) + input.content.trim().length + 40),
    origin: note.origin,
    topics: (input.topics?.length ? input.topics.filter((t): t is ExamTopic => EXAM_TOPICS.includes(t as ExamTopic)) : tagsToTopics(note.front.tags || [])) as ExamTopic[],
    scenes: input.scenes || ['案例分析'],
    status: input.confirm ? 'confirmed' : 'candidate',
    mastery: 'new',
    createdAt: new Date().toISOString(),
    extractorVersion: 'mobile-local-v1',
    confirmedBy: input.confirm ? 'human' : undefined,
  };
  cards.push(card);
  await saveCards(cards);
  return card;
}

export async function setCardStatus(id: string, status: CompileStatus): Promise<MaterialCard> {
  const cards = await allCards();
  const c = cards.find(x => x.cardId === id);
  if (!c) throw new Error('卡片不存在');
  c.status = status;
  await saveCards(cards);
  return c;
}
export async function setCardMastery(id: string, mastery: Mastery): Promise<MaterialCard> {
  const cards = await allCards();
  const c = cards.find(x => x.cardId === id);
  if (!c) throw new Error('卡片不存在');
  c.mastery = mastery;
  await saveCards(cards);
  return c;
}

// ---------- 检索（中文子串 / 多词 AND） ----------
function matchText(haystack: string, q: string): boolean {
  if (!q.trim()) return true;
  const terms = q.trim().split(/\s+/).filter(Boolean);
  const lower = haystack.toLowerCase();
  return terms.every(t => lower.includes(t.toLowerCase()));
}

export async function search(q: string, filters: Record<string, string> = {}): Promise<SearchResult> {
  const notes = (await noteStore.list()).map(toSharedNote);
  const cards = await allCards();
  const hits: SearchHit[] = [];

  if (filters.kind !== 'card') {
    for (const n of notes) {
      if (!matchText(`${n.front.title || ''} ${n.body} ${n.front.site || ''}`, q)) continue;
      if (filters.site && n.front.site !== filters.site) continue;
      const pos = n.body.toLowerCase().indexOf(q.trim().toLowerCase());
      const snippet = pos >= 0 ? n.body.slice(Math.max(0, pos - 30), pos + q.length + 40) : n.body.slice(0, 80);
      hits.push({
        kind: 'note', id: n.sourceId, sourceId: n.sourceId, title: n.front.title || '未命名笔记',
        content: n.body.slice(0, 120), snippet, site: n.front.site || '', score: 1,
      } as SearchHit);
    }
  }
  if (filters.kind !== 'note') {
    for (const c of cards) {
      if (!matchText(`${c.content} ${c.sourceExcerpt} ${c.origin.site}`, q)) continue;
      if (filters.type && c.type !== filters.type) continue;
      if (filters.status && c.status !== filters.status) continue;
      if (filters.topic && !c.topics.includes(filters.topic as ExamTopic)) continue;
      hits.push({
        kind: 'card', id: c.cardId, cardId: c.cardId, sourceId: c.sourceId,
        title: `${TYPE_LABEL[c.type]} · ${c.origin.site}`, content: c.content,
        snippet: c.sourceExcerpt.slice(0, 80), site: c.origin.site, score: 1,
        type: c.type, status: c.status, topics: c.topics,
      } as SearchHit);
    }
  }
  const limit = filters.limit ? Number(filters.limit) : 100;
  return { total: hits.length, hits: hits.slice(0, limit) };
}

// ---------- 统计 / 主题 / bundle / 复习 ----------
export async function stats(): Promise<AppStats> {
  const notes = await noteStore.list();
  const cards = await allCards();
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byTopic: Record<string, number> = {};
  for (const c of cards) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    byType[c.type] = (byType[c.type] || 0) + 1;
    for (const t of c.topics) byTopic[t] = (byTopic[t] || 0) + 1;
  }
  return {
    notes: notes.length, cards: cards.length, notesFts: notes.length, cardsFts: cards.length,
    byStatus, byType, byTopic,
  };
}

export async function topics(): Promise<TopicSummary[]> {
  const cards = await allCards();
  return EXAM_TOPICS.map(topic => {
    const list = cards.filter(c => c.topics.includes(topic));
    const types: Partial<Record<MaterialType, number>> = {};
    for (const c of list) types[c.type] = (types[c.type] || 0) + 1;
    return { topic, count: list.length, types };
  });
}

export async function bundle(topic?: string): Promise<TopicBundle> {
  let cards = await allCards();
  if (topic && topic !== '全部') cards = cards.filter(c => c.topics.includes(topic as ExamTopic));
  const by = (t: MaterialType) => cards.filter(c => c.type === t);
  return {
    topic: topic || '全部', total: cards.length,
    golden_sentence: by('golden_sentence'), subheading: by('subheading'),
    practice: by('practice'), article: by('article'),
  };
}

export async function review(): Promise<ReviewCard[]> {
  const cards = await allCards();
  const order: Record<Mastery, number> = { new: 0, reviewing: 1, mastered: 2 };
  return cards.filter(c => c.status === 'confirmed').map(c => ({
    cardId: c.cardId,
    front: `${c.topics.join(' / ')} · ${TYPE_LABEL[c.type]}`,
    back: c.content,
    originText: c.origin.site,
    sourceId: c.sourceId,
    mastery: c.mastery,
    type: c.type,
  } as ReviewCard)).sort((a, b) => order[a.mastery] - order[b.mastery]);
}

export async function listNotes(): Promise<SharedNote[]> {
  return (await noteStore.list()).map(toSharedNote);
}

// ---------- 导出 / 导入（JSON，含全部事实源） ----------
export async function exportBundleBase64(): Promise<{ base64: string; bytes: number }> {
  const payload = JSON.stringify({
    version: 1, exportedAt: new Date().toISOString(),
    notes: await noteStore.list(), cards: await allCards(),
  });
  const bytes = new TextEncoder().encode(payload);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return { base64: btoa(bin), bytes: bytes.length };
}

export async function importBundleBase64(base64: string): Promise<{ ok: boolean; errors: string[]; imported: number }> {
  try {
    const bin = atob(base64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as { notes?: StoredNote[]; cards?: MaterialCard[] };
    let imported = 0;
    if (Array.isArray(data.notes)) for (const n of data.notes) { await noteStore.save(n); imported++; }
    if (Array.isArray(data.cards)) {
      const existing = await allCards();
      const ids = new Set(existing.map(c => c.cardId));
      for (const c of data.cards) if (!ids.has(c.cardId)) { existing.push(c); imported++; }
      await saveCards(existing);
    }
    return { ok: true, errors: [], imported };
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : '导入失败'], imported: 0 };
  }
}

export { TYPE_LABEL };
