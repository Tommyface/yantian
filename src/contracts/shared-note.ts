/**
 * 共享笔记契约 (Shared Note Contract)
 *
 * 完全对齐「拾页」(shiye-android) 的真实 front matter 格式，
 * 权威来源：EntryFile.kt / Library.kt / Entry.kt 实读。
 *
 * 设计原则：
 * 1. 不发明新格式 —— 拾页写什么，我们就认什么。
 * 2. 只读 —— 砚田绝不回写 library/*.md，避免破坏拾页的严格解析。
 * 3. 扩展用 x-yantian-* 前缀 —— 追加字段，不动拾页既有字段。
 */

/** 素材类型（对齐方案 v1.2 的四类） */
export type MaterialType = 'golden_sentence' | 'subheading' | 'practice' | 'article';

/** 抽取/处理状态机（借鉴 zhijian-skills 的 source_candidate 状态） */
export type CompileStatus = 'unprocessed' | 'candidate' | 'confirmed' | 'used';

/** 掌握度（复习层用） */
export type Mastery = 'new' | 'reviewing' | 'mastered';

/** 遴选能力维度（主题标签的标准值域，可从拾页 tags 映射而来） */
export const EXAM_TOPICS = [
  '政策理论',
  '综合分析',
  '文字表达',
  '山东实践',
] as const;
export type ExamTopic = (typeof EXAM_TOPICS)[number];

/** 适用场景（对齐山东遴选笔试：案例分析 + 事务性文书） */
export const SCENES = ['案例分析', '事务性文书', '政策理论'] as const;
export type Scene = (typeof SCENES)[number];

/**
 * 拾页 front matter 原始字段（as-is）。
 * 字段名与拾页 render() 输出逐字一致。
 */
export interface ShiyeFrontMatter {
  title?: string;
  source_url?: string;
  source_type?: string; // 'web' | 'clip' | ...
  site?: string;
  author?: string;
  published_at?: string;
  captured_at?: string; // ISO_OFFSET_DATE_TIME, e.g. 2026-08-04T09:30:12+08:00
  category?: string; // 'inbox' 或用户自建分类
  tags?: string[]; // 拾页写为 [a, b]，解析后为数组
  status?: string; // 'inbox' | 'read'
  content_hash?: string; // sha256(source_url + body.take(2000)).take(8)
  quality?: string; // 'clean' | ...
  ocr?: string; // 'none' | ...
  warnings?: string[];
  /** 砚田扩展字段（可选，拾页不认识但会原样保留在 front matter 里） */
  'x-yantian-compile-status'?: CompileStatus;
  'x-yantian-extractor-version'?: string;
}

/**
 * 解析后的共享笔记（砚田内部表示）。
 * source_id 是拾页文件名中的 id 部分：yyyyMMdd-HHmmss-hash
 */
export interface SharedNote {
  /** 拾页 id：文件名去掉 -slug.md 后的部分 */
  sourceId: string;
  /** 原始文件路径（相对 vault 根，如 library/inbox/xxx.md） */
  filePath: string;
  /** front matter 原始字段 */
  front: ShiyeFrontMatter;
  /** Markdown 正文（front matter 之后的内容） */
  body: string;
  /** 派生：归一化后的出处（只读） */
  origin: NoteOrigin;
  /** 派生：缺失的关键字段（用于降级/告警） */
  warnings: string[];
}

/** 从笔记派生的出处（只读，禁止编辑） */
export interface NoteOrigin {
  url: string;
  site: string;
  author: string;
  capturedAt: string;
}

/** source_id 正则：yyyyMMdd-HHmmss-8位hash */
export const SOURCE_ID_RE = /^(\d{8}-\d{6})-([0-9a-f]{8})$/;

/** 砚田扩展字段前缀 */
export const YANTIAN_PREFIX = 'x-yantian-';
