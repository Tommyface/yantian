/**
 * AI 素材抽取器（可插拔）
 *
 * 设计原则（呼应方案 RK-01 最高风险）：
 *  1. AI 只产出「候选」，绝不自动入库为 confirmed —— 必须人工确认。
 *  2. 每个候选 content 必须是原文 body 的逐字子串（verifyVerbatim），
 *     否则丢弃 —— 从机制上杜绝改写/编造党媒金句。
 *  3. 后端可插拔：默认本地规则抽取（零依赖、可离线）；本地模型(Ollama)、
 *     外部 API 作为可选后端预留，由配置启用。
 *
 * 抽取后端接口统一，未来切换模型不影响上层。
 */

import type { SharedNote, MaterialType, ExamTopic, Scene } from '../contracts/index.js';
import { verifyVerbatim, locateExcerpt } from '../p0/material-card.js';

/** 抽取候选 */
export interface ExtractionCandidate {
  type: MaterialType;
  content: string;
  sourceExcerpt: string;
  excerptLoc: { para: number; charStart: number };
  confidence: number;
  reason?: string;
  topics?: ExamTopic[];
  scenes?: Scene[];
}

/** 抽取结果 */
export interface ExtractionResult {
  sourceId: string;
  extractor: string;
  candidates: ExtractionCandidate[];
  /** 因逐字校验失败被丢弃的数量（可观测性） */
  rejected: number;
}

/** 抽取后端接口 */
export interface Extractor {
  readonly name: string;
  extract(note: SharedNote): Promise<ExtractionResult>;
}

/**
 * 把「原始候选文本」转为合规候选：强制逐字校验 + 计算位置。
 * 所有后端产出都必须过这一关。
 */
export function buildCandidates(
  note: SharedNote,
  raw: Array<{ text: string; type: MaterialType; confidence: number; reason?: string; topics?: ExamTopic[]; scenes?: Scene[] }>
): ExtractionResult {
  const candidates: ExtractionCandidate[] = [];
  let rejected = 0;
  for (const item of raw) {
    const text = item.text.trim();
    if (!text) continue;
    // 逐字底线：不是原文子串一律丢弃
    if (!verifyVerbatim(text, note.body).ok) { rejected++; continue; }
    const loc = locateExcerpt(text, note.body);
    const sourceExcerpt = note.body.slice(
      Math.max(0, loc.charStart - 50),
      loc.charStart + text.length + 50
    );
    candidates.push({
      type: item.type,
      content: text,
      sourceExcerpt,
      excerptLoc: loc,
      confidence: item.confidence,
      reason: item.reason,
      topics: item.topics,
      scenes: item.scenes,
    });
  }
  // 按置信度降序
  candidates.sort((a, b) => b.confidence - a.confidence);
  return { sourceId: note.sourceId, extractor: 'shared', candidates, rejected };
}

/** 中文句末标点 */
const SENT_END = /[。！？!?；;]/;
/** 金句信号词（对仗/号召/判断句式） */
const GOLDEN_SIGNALS = [
  '贵在', '关键在于', '根本在于', '要', '必须', '就是', '是', '不是',
  '只有', '才能', '既要', '又要', '一锤', '久久为功', '持之以恒',
  '基石', '根本', '核心', '关键', '主旋律', '抓手', '落脚点',
];

/**
 * 本地规则抽取器（零依赖、可离线、默认启用）。
 * - 小标题：Markdown 的 ## / ### 标题行、或形如「一、二、三、」的段首。
 * - 金句：按句末标点切分，含信号词且长度适中的句子打分。
 */
export class RuleExtractor implements Extractor {
  readonly name = 'rule-local-v1';

  async extract(note: SharedNote): Promise<ExtractionResult> {
    const raw: Array<{ text: string; type: MaterialType; confidence: number; reason?: string }> = [];

    // 1) 小标题候选
    for (const line of note.body.split('\n')) {
      const t = line.trim();
      const m = t.match(/^#{2,3}\s+(.+)$/);
      const cn = t.match(/^[一二三四五六七八九十]+、\s*(.+)$/);
      const title = m?.[1] ?? cn?.[1];
      if (title && title.length >= 4 && title.length <= 30) {
        raw.push({ text: title, type: 'subheading', confidence: 0.8, reason: 'Markdown/编号标题' });
      }
    }

    // 2) 金句候选：按句末标点切句
    const sentences = note.body
      .split(/\n\s*\n/)                 // 先按段落
      .flatMap((para) => para.split(/(?<=[。！？!?；;])/)) // 再按句末标点（保留标点）
      .map((s) => s.trim())
      .filter(Boolean);

    for (const s of sentences) {
      // 去掉列表符号/标题符号后再判断，但校验仍用原句
      const clean = s.replace(/^[#>\-\*\d\.\s]+/, '');
      if (clean.length < 12 || clean.length > 120) continue;
      if (SENT_END.test(clean) === false) continue;

      let score = 0.3;
      const hits = GOLDEN_SIGNALS.filter((w) => clean.includes(w));
      score += Math.min(hits.length * 0.12, 0.45);
      // 对仗/排比：含逗号且两侧都较长
      if (clean.includes('，')) score += 0.1;
      // 篇幅适中加分
      if (clean.length >= 20 && clean.length <= 60) score += 0.1;

      if (score >= 0.45) {
        raw.push({ text: s, type: 'golden_sentence', confidence: Math.min(score, 0.99), reason: `规则打分 ${score.toFixed(2)}` });
      }
    }

    const result = buildCandidates(note, raw);
    result.extractor = this.name;
    return result;
  }
}

/** 本地模型（Ollama）后端配置 */
export interface OllamaConfig {
  baseUrl?: string;        // 默认 http://127.0.0.1:11434
  model?: string;          // 默认 qwen2.5:7b
  timeoutMs?: number;
  /** 由上层注入的 HTTP 调用函数（便于测试与自定义，避免直接依赖 fetch 环境） */
  fetcher?: (url: string, init: RequestInit) => Promise<{ ok: boolean; text(): Promise<string> }>;
}

/**
 * 本地模型后端（预留）——通过 Ollama 的 HTTP 接口调用本机模型。
 * 要求模型输出 JSON 数组 [{text, type}]，再统一走 buildCandidates 逐字校验。
 * 默认不启用；启用后若模型不可用，上层应回退到 RuleExtractor。
 */
export class OllamaExtractor implements Extractor {
  readonly name: string;
  private cfg: Required<Omit<OllamaConfig, 'fetcher'>> & Pick<OllamaConfig, 'fetcher'>;

  constructor(config: OllamaConfig = {}) {
    this.cfg = {
      baseUrl: config.baseUrl ?? 'http://127.0.0.1:11434',
      model: config.model ?? 'qwen2.5:7b',
      timeoutMs: config.timeoutMs ?? 30000,
      fetcher: config.fetcher,
    };
    this.name = `ollama-${this.cfg.model}`;
  }

  async extract(note: SharedNote): Promise<ExtractionResult> {
    const prompt = `你是中文材料写作助手。从下面文章中抽取「金句」和「小标题」。
要求：
1. 每条必须是原文中连续、逐字一致的片段，禁止改写、缩写、编造。
2. 只输出 JSON 数组，元素格式 {"text":"原文片段","type":"golden_sentence|subheading"}，不要其他文字。
3. 最多 8 条。

文章标题：${note.front.title ?? ''}
正文：
${note.body.slice(0, 3000)}`;

    const doFetch = this.cfg.fetcher ?? ((url: string, init: RequestInit) => fetch(url, init));
    const resp = await doFetch(`${this.cfg.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.cfg.model, prompt, stream: false, format: 'json' }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.ok}`);
    const data = JSON.parse(await resp.text()) as { response?: string };
    let parsed: Array<{ text: string; type: MaterialType }> = [];
    try {
      const raw = JSON.parse(data.response ?? '[]');
      if (Array.isArray(raw)) {
        parsed = raw.filter((x) => typeof x.text === 'string' && x.type);
      }
    } catch {
      // 模型输出非 JSON → 返回空候选（上层可回退规则抽取）
    }
    const result = buildCandidates(note, parsed.map((p) => ({
      text: p.text, type: p.type, confidence: 0.9, reason: '本地模型抽取',
    })));
    result.extractor = this.name;
    return result;
  }
}

/**
 * 组合抽取器：优先主后端，失败时回退规则抽取。
 * 保证「AI 不可用也能用」，符合本地优先、稳健原则。
 */
export class FallbackExtractor implements Extractor {
  readonly name: string;
  constructor(private primary: Extractor, private fallback: Extractor = new RuleExtractor()) {
    this.name = `${primary.name}+fallback:${fallback.name}`;
  }
  async extract(note: SharedNote): Promise<ExtractionResult> {
    try {
      return await this.primary.extract(note);
    } catch {
      const r = await this.fallback.extract(note);
      r.extractor = this.name;
      return r;
    }
  }
}
