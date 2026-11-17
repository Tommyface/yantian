/**
 * 主题归纳与复习卡
 *
 * 服务于两大场景：
 *  1. 写作台：按主题词调取「成套素材包」（金句/小标题/案例），一键复制含出处。
 *  2. 复习：从已确认素材生成卡片（正面主题、背面素材+出处），
 *     按掌握度排序（new/reviewing 优先，mastered 靠后）。
 */

import type { MaterialCard, MaterialType, ExamTopic, Mastery } from '../contracts/index.js';
import { EXAM_TOPICS } from '../contracts/index.js';

/** 主题素材包 */
export interface TopicBundle {
  topic: string;
  total: number;
  golden_sentence: MaterialCard[];
  subheading: MaterialCard[];
  practice: MaterialCard[];
  article: MaterialCard[];
}

/** 按主题聚合素材包（写作台核心）。可指定主题，或聚合全部。 */
export function buildTopicBundle(cards: MaterialCard[], topic?: string): TopicBundle {
  const picked = topic
    ? cards.filter((c) => c.topics.includes(topic as ExamTopic))
    : cards;
  const byType = (t: MaterialType) => picked.filter((c) => c.type === t);
  return {
    topic: topic ?? '全部',
    total: picked.length,
    golden_sentence: byType('golden_sentence'),
    subheading: byType('subheading'),
    practice: byType('practice'),
    article: byType('article'),
  };
}

/** 全部主题的概览（含每类数量），用于写作台主题导航 */
export interface TopicSummary {
  topic: string;
  count: number;
  types: Partial<Record<MaterialType, number>>;
}

export function listTopicSummaries(cards: MaterialCard[]): TopicSummary[] {
  const map = new Map<string, TopicSummary>();
  // 内置四个遴选主题始终出现（数量为 0 也列出，便于导航）
  for (const t of EXAM_TOPICS) map.set(t, { topic: t, count: 0, types: {} });
  for (const c of cards) {
    for (const t of c.topics) {
      if (!map.has(t)) map.set(t, { topic: t, count: 0, types: {} });
      const s = map.get(t)!;
      s.count++;
      s.types[c.type] = (s.types[c.type] ?? 0) + 1;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** 复习卡：正面主题/提示，背面素材与出处 */
export interface ReviewCard {
  cardId: string;
  front: string;          // 主题 + 类型提示
  back: string;           // 素材内容
  originText: string;     // 出处（媒体 + 链接）
  sourceId: string;
  mastery: Mastery;
  type: MaterialType;
}

/** 生成复习卡：仅取 confirmed/used 的素材（未确认的不进复习） */
export function buildReviewDeck(cards: MaterialCard[]): ReviewCard[] {
  return cards
    .filter((c) => c.status === 'confirmed' || c.status === 'used')
    .map((c) => ({
      cardId: c.cardId,
      front: `${c.topics.join(' / ') || '综合'} · ${typeLabel(c.type)}`,
      back: c.content,
      originText: [c.origin.site, c.origin.url].filter(Boolean).join(' · '),
      sourceId: c.sourceId,
      mastery: c.mastery,
      type: c.type,
    }));
}

/** 掌握度优先级：new/reviewing 优先（待巩固），mastered 靠后 */
const MASTERY_PRIORITY: Record<Mastery, number> = { new: 0, reviewing: 1, mastered: 2 };

export function orderReviewDeck(deck: ReviewCard[]): ReviewCard[] {
  return [...deck].sort((a, b) => MASTERY_PRIORITY[a.mastery] - MASTERY_PRIORITY[b.mastery]);
}

/** 生成可复制的引用文本（含出处），写作台一键复制用 */
export function toCitation(card: MaterialCard): string {
  const src = [card.origin.site, card.origin.author].filter(Boolean).join(' · ');
  return `“${card.content}”\n—— ${src || '出处见原文'}${card.origin.url ? `（${card.origin.url}）` : ''}`;
}

function typeLabel(t: MaterialType): string {
  return ({ golden_sentence: '金句', subheading: '小标题', practice: '改革实践', article: '好文章' } as Record<MaterialType, string>)[t] ?? t;
}
