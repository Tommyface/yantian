/**
 * 素材卡片契约 (Material Card Contract)
 *
 * 载体：cards.jsonl，一行一张卡片。
 * 核心不变量：
 *  - 每张卡片通过 sourceId 指向拾页原文（单一事实源）。
 *  - origin 从原文派生，只读。
 *  - content 必须是原文 body 的逐字子串 —— 防误引的技术底线。
 *  - 出处（origin.url）与原文片段（sourceExcerpt）强制存在。
 */

import type { MaterialType, CompileStatus, Mastery, ExamTopic, Scene } from './shared-note.js';

/** 原文位置（用于核对与跳转） */
export interface ExcerptLocation {
  /** 段落序号（从 1 起，按空行分段） */
  para: number;
  /** 在正文中的字符起始偏移 */
  charStart: number;
}

/** 出处（从 SharedNote 派生，只读） */
export interface CardOrigin {
  url: string;
  site: string;
  author: string;
  capturedAt: string;
}

/** 素材卡片完整结构 */
export interface MaterialCard {
  /** 卡片唯一 ID（UUID） */
  cardId: string;
  /** 指向拾页原文的 source_id */
  sourceId: string;
  /** 素材类型 */
  type: MaterialType;
  /** 素材内容：必须是原文 body 的逐字子串 */
  content: string;
  /** 原文片段上下文（供核对，必填） */
  sourceExcerpt: string;
  /** 原文位置 */
  excerptLoc: ExcerptLocation;
  /** 出处（派生，只读） */
  origin: CardOrigin;
  /** 主题标签（对齐遴选能力） */
  topics: ExamTopic[];
  /** 适用场景 */
  scenes: Scene[];
  /** 处理状态 */
  status: CompileStatus;
  /** 掌握度 */
  mastery: Mastery;
  /** 抽取器版本（可追溯复现） */
  extractorVersion: string;
  /** 确认人：human | import（防误引留痕） */
  confirmedBy: 'human' | 'import';
  /** 创建时间（ISO） */
  createdAt: string;
}

/** 合法的素材类型值 */
export const MATERIAL_TYPES: readonly MaterialType[] = [
  'golden_sentence',
  'subheading',
  'practice',
  'article',
];

/** 状态机允许的转换 */
export const STATUS_TRANSITIONS: Record<CompileStatus, readonly CompileStatus[]> = {
  unprocessed: ['candidate'],
  candidate: ['confirmed', 'unprocessed'],
  confirmed: ['used', 'candidate'],
  used: ['confirmed'],
};

/** 校验结果 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 用于创建卡片的最小输入（其余字段由系统填充） */
export interface NewCardInput {
  sourceId: string;
  type: MaterialType;
  content: string;
  sourceExcerpt: string;
  excerptLoc: ExcerptLocation;
  origin: CardOrigin;
  topics?: ExamTopic[];
  scenes?: Scene[];
  extractorVersion?: string;
  confirmedBy?: 'human' | 'import';
}
