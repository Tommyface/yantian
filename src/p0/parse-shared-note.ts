/**
 * 共享笔记解析器
 *
 * 读取拾页产出的 library/*.md，解析其 front matter 为 SharedNote。
 * 严格对齐拾页 EntryFile.parse / Library.save 的真实格式。
 */

import matter from 'gray-matter';
import * as yaml from 'js-yaml';
import { basename } from 'node:path';
import type {
  SharedNote,
  ShiyeFrontMatter,
  NoteOrigin,
  CompileStatus,
} from '../contracts/index.js';
import {
  SOURCE_ID_RE,
  YANTIAN_PREFIX,
  EXAM_TOPICS,
  type ExamTopic,
} from '../contracts/index.js';

/**
 * 自定义 YAML 引擎：用 JSON_SCHEMA 禁用 js-yaml 的隐式类型转换。
 * 关键：默认 schema 会把 captured_at(ISO 时间戳) 解析成 JS Date 对象，
 * 破坏拾页原始字符串（含 +08:00 时区偏移）——溯源字段必须逐字保留。
 */
const yamlEngine = {
  parse: (str: string): object =>
    (yaml.load(str, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>) ?? {},
  stringify: (obj: object): string => yaml.dump(obj),
};

/** 解析选项 */
export interface ParseOptions {
  /** 文件相对 vault 根的路径，如 library/inbox/20260804-093012-a1b2c3d4-xxx.md */
  filePath: string;
  /** 是否把拾页自由标签映射为遴选主题标签（默认否，保留原样） */
  mapTopics?: boolean;
}

/** 标签映射规则：拾页中文 tag → 遴选主题。可配置为外部规则表。 */
const DEFAULT_TOPIC_MAP: Record<string, ExamTopic> = {
  政策理论: '政策理论',
  理论: '政策理论',
  综合分析: '综合分析',
  文字表达: '文字表达',
  写作: '文字表达',
  山东: '山东实践',
  山东实践: '山东实践',
  省情: '山东实践',
};

/** 把拾页自由标签映射为遴选主题标签 */
export function mapTagsToTopics(tags: string[], customMap?: Record<string, ExamTopic>): ExamTopic[] {
  const table = { ...DEFAULT_TOPIC_MAP, ...(customMap ?? {}) };
  const result = new Set<ExamTopic>();
  for (const tag of tags) {
    const hit = table[tag];
    if (hit && (EXAM_TOPICS as readonly string[]).includes(hit)) {
      result.add(hit);
    }
  }
  return [...result];
}

/** 从文件名提取 source_id：yyyyMMdd-HHmmss-hash-slug.md → yyyyMMdd-HHmmss-hash */
export function extractSourceId(filePath: string): string | null {
  const name = basename(filePath, '.md');
  // 文件名格式：{id}-{slug}，id 自身含一个 '-'，hash 后才是 slug 分隔
  // 用正则从开头匹配 yyyyMMdd-HHmmss-8hex
  const m = name.match(/^(\d{8}-\d{6}-[0-9a-f]{8})(?:-|$)/i);
  return m ? m[1] : null;
}

/** 规范化数组字段：gray-matter 可能给出字符串或数组 */
function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    // 兼容 "a, b" 形式
    return v.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

/** 规范化字符串字段 */
function asString(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * 解析一份拾页 Markdown 笔记。
 * 缺少 front matter 或关键字段时仍返回对象，并把问题记入 warnings（降级而非抛异常）。
 */
export function parseSharedNote(raw: string, options: ParseOptions): SharedNote {
  const parsed = matter(raw, { engines: { yaml: yamlEngine } });
  const data = parsed.data as Record<string, unknown>;

  const front: ShiyeFrontMatter = {
    title: asString(data.title),
    source_url: asString(data.source_url),
    source_type: asString(data.source_type) || undefined,
    site: asString(data.site) || undefined,
    author: asString(data.author) || undefined,
    published_at: asString(data.published_at) || undefined,
    captured_at: asString(data.captured_at) || undefined,
    category: asString(data.category) || undefined,
    tags: asArray(data.tags),
    status: asString(data.status) || undefined,
    content_hash: asString(data.content_hash) || undefined,
    quality: asString(data.quality) || undefined,
    ocr: asString(data.ocr) || undefined,
    warnings: asArray(data.warnings),
  };

  // 砚田扩展字段（x-yantian-*）
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(YANTIAN_PREFIX)) {
      (front as Record<string, unknown>)[key] =
        key === 'x-yantian-compile-status' ? (asString(value) as CompileStatus) : asString(value);
    }
  }

  const warnings: string[] = [...(front.warnings ?? [])];

  // source_id：优先文件名，其次无法推断则告警
  const sourceId = extractSourceId(options.filePath);
  if (!sourceId) {
    warnings.push('无法从文件名解析 source_id（不符合拾页命名规范）');
  }

  // 出处派生（只读）
  const origin: NoteOrigin = {
    url: front.source_url ?? '',
    site: front.site ?? '',
    author: front.author ?? '',
    capturedAt: front.captured_at ?? '',
  };
  if (!origin.url) warnings.push('缺少 source_url（引用来源强制项）');
  if (!origin.capturedAt) warnings.push('缺少 captured_at（溯源留痕）');

  // 主题映射（可选）
  if (options.mapTopics && front.tags?.length) {
    // 映射结果放在扩展字段，不污染原 tags
    (front as Record<string, unknown>)['x-yantian-topics'] = mapTagsToTopics(front.tags);
  }

  return {
    sourceId: sourceId ?? `unknown-${asString(data.content_hash) || 'na'}`,
    filePath: options.filePath,
    front,
    body: parsed.content.trim(),
    origin,
    warnings,
  };
}

/** 校验 source_id 格式是否符合拾页规范 */
export function isValidSourceId(id: string): boolean {
  return SOURCE_ID_RE.test(id);
}
