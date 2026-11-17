/**
 * 素材卡片校验与 JSONL 存储
 *
 * 核心不变量（防误引的技术底线）：
 *  1. content 必须是原文 body 的逐字子串。
 *  2. sourceExcerpt 必填，且最好也来自原文。
 *  3. origin.url 必填（引用来源强制）。
 *  4. 状态转换符合状态机。
 *
 * 载体 cards.jsonl：一行一张卡片，追加式写入。
 */

import { randomUUID } from 'node:crypto';
import type {
  MaterialCard,
  NewCardInput,
  ValidationResult,
  CompileStatus,
  SharedNote,
} from '../contracts/index.js';
import {
  MATERIAL_TYPES,
  STATUS_TRANSITIONS,
} from '../contracts/index.js';

/** 校验一张卡片（不依赖原文，只校验自身字段完整性） */
export function validateCardShape(card: MaterialCard): ValidationResult {
  const errors: string[] = [];
  if (!card.cardId) errors.push('缺少 cardId');
  if (!card.sourceId) errors.push('缺少 sourceId');
  if (!MATERIAL_TYPES.includes(card.type)) errors.push(`非法 type: ${card.type}`);
  if (!card.content?.trim()) errors.push('content 为空');
  if (!card.sourceExcerpt?.trim()) errors.push('缺少 sourceExcerpt（原文片段）');
  if (!card.origin?.url?.trim()) errors.push('缺少 origin.url（引用来源强制）');
  if (!card.origin?.capturedAt) errors.push('缺少 origin.capturedAt');
  if (!Array.isArray(card.excerptLoc) && typeof card.excerptLoc?.charStart !== 'number') {
    errors.push('excerptLoc.charStart 非法');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 逐字约束校验：content 必须是原文 body 的逐字子串。
 * 这是"绝不编造金句"的技术底线 —— 过了这关才允许入库。
 */
export function verifyVerbatim(content: string, noteBody: string): ValidationResult {
  const errors: string[] = [];
  const needle = content.trim();
  if (!needle) {
    errors.push('content 为空，无法校验逐字一致');
  } else if (!noteBody.includes(needle)) {
    errors.push('content 不是原文的逐字子串（禁止改写/编造金句）');
  }
  return { ok: errors.length === 0, errors };
}

/** 计算 content 在正文中的位置（段落号 + 字符偏移） */
export function locateExcerpt(content: string, noteBody: string) {
  const charStart = noteBody.indexOf(content.trim());
  const before = charStart >= 0 ? noteBody.slice(0, charStart) : '';
  const para = before.split(/\n\s*\n/).length;
  return { para, charStart };
}

/** 从 SharedNote 派生卡片出处（只读） */
export function originFromNote(note: SharedNote) {
  return {
    url: note.origin.url,
    site: note.origin.site,
    author: note.origin.author,
    capturedAt: note.origin.capturedAt,
  };
}

/** 创建一张新卡片（自动生成 id/时间/默认字段），但不落盘 */
export function createCard(input: NewCardInput, note: SharedNote): MaterialCard {
  return {
    cardId: randomUUID(),
    sourceId: input.sourceId,
    type: input.type,
    content: input.content.trim(),
    sourceExcerpt: input.sourceExcerpt.trim(),
    excerptLoc: input.excerptLoc,
    origin: input.origin ?? originFromNote(note),
    topics: input.topics ?? [],
    scenes: input.scenes ?? [],
    status: 'candidate',
    mastery: 'new',
    extractorVersion: input.extractorVersion ?? 'manual-v1',
    confirmedBy: input.confirmedBy ?? 'human',
    createdAt: new Date().toISOString(),
  };
}

/** 校验状态转换是否合法 */
export function canTransition(from: CompileStatus, to: CompileStatus): boolean {
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** JSONL 存储 */
export class CardStore {
  private cards: Map<string, MaterialCard> = new Map();

  constructor(cards: MaterialCard[] = []) {
    for (const c of cards) this.cards.set(c.cardId, c);
  }

  /** 从 JSONL 文本加载 */
  static fromJSONL(text: string): CardStore {
    const cards: MaterialCard[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        cards.push(JSON.parse(trimmed) as MaterialCard);
      } catch {
        // 跳过损坏行，不中断整体加载（容错）
      }
    }
    return new CardStore(cards);
  }

  /** 导出为 JSONL 文本（稳定顺序：按创建时间） */
  toJSONL(): string {
    return [...this.cards.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => JSON.stringify(c))
      .join('\n') + (this.cards.size ? '\n' : '');
  }

  /** 计算 content 的指纹（用于近似重复检测前的精确比对） */
  private fingerprint(content: string, sourceId: string): string {
    return `${sourceId}::${content.trim()}`;
  }

  /** 追加一张卡片，返回是否成功（逐字约束 + 出处 + 精确去重） */
  add(card: MaterialCard, noteBody: string): ValidationResult {
    const errors: string[] = [];

    const shape = validateCardShape(card);
    errors.push(...shape.errors);

    const verbatim = verifyVerbatim(card.content, noteBody);
    errors.push(...verbatim.errors);

    // 精确去重：同原文 + 同内容不重复入库
    for (const existing of this.cards.values()) {
      if (
        this.fingerprint(existing.content, existing.sourceId) ===
        this.fingerprint(card.content, card.sourceId)
      ) {
        errors.push('重复卡片：同一原文下已存在内容相同的素材');
        break;
      }
    }

    if (errors.length) return { ok: false, errors };
    this.cards.set(card.cardId, card);
    return { ok: true, errors: [] };
  }

  /** 更新卡片状态（走状态机校验） */
  updateStatus(cardId: string, to: CompileStatus): ValidationResult {
    const card = this.cards.get(cardId);
    if (!card) return { ok: false, errors: ['卡片不存在'] };
    if (!canTransition(card.status, to)) {
      return { ok: false, errors: [`非法状态转换：${card.status} → ${to}`] };
    }
    this.cards.set(cardId, { ...card, status: to });
    return { ok: true, errors: [] };
  }

  /** 更新掌握度 */
  updateMastery(cardId: string, mastery: MaterialCard['mastery']): ValidationResult {
    const card = this.cards.get(cardId);
    if (!card) return { ok: false, errors: ['卡片不存在'] };
    this.cards.set(cardId, { ...card, mastery });
    return { ok: true, errors: [] };
  }

  /** 按 cardId 精确取卡片 */
  get(cardId: string): MaterialCard | undefined {
    return this.cards.get(cardId);
  }

  /** 按 sourceId 查询 */
  bySource(sourceId: string): MaterialCard[] {
    return [...this.cards.values()].filter((c) => c.sourceId === sourceId);
  }

  /** 按状态查询 */
  byStatus(status: CompileStatus): MaterialCard[] {
    return [...this.cards.values()].filter((c) => c.status === status);
  }

  /** 全部卡片 */
  all(): MaterialCard[] {
    return [...this.cards.values()];
  }

  get size(): number {
    return this.cards.size;
  }
}
