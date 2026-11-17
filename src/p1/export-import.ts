/**
 * 导出导入包 + 手动导入通道
 *
 * 导出包（zip）结构：
 *   manifest.json   版本/时间/计数 + 每个文件的 SHA256（防篡改、防损坏）
 *   cards.jsonl     全部素材卡片（事实源）
 *   notes/*.md      卡片引用的拾页原文（供导入端复核逐字一致 + 出处）
 *
 * 导入原则：
 *  - 先校验 manifest 逐文件 SHA256，损坏即拒绝。
 *  - 卡片逐字约束重新校验（content 必须在其原文 body 中）。
 *  - 出处强制（origin.url）。
 *  - 幂等：同 sourceId + 同 content 不重复入库（复用 CardStore）。
 *
 * 这是 MVP 的跨设备兜底通道（手机拾页导出 → 电脑砚田导入）。
 */

import { createHash } from 'node:crypto';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { CardStore, verifyVerbatim, locateExcerpt, createCard, originFromNote } from '../p0/material-card.js';
import { parseSharedNote } from '../p0/parse-shared-note.js';
import type { MaterialCard, SharedNote, MaterialType, ExamTopic, Scene } from '../contracts/index.js';

export const EXPORT_FORMAT_VERSION = 1;

interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
}

export interface ExportManifest {
  format: 'yantian-bundle';
  version: number;
  exportedAt: string;
  tool: string;
  counts: { cards: number; notes: number };
  files: ManifestFile[];
}

export interface ExportInput {
  cards: MaterialCard[];
  /** 原文：sourceId → 完整 Markdown 原始文本（含 front matter） */
  notes: Map<string, string>;
  now?: () => Date;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 生成导出包（返回 zip 字节） */
export function createExportBundle(input: ExportInput): Uint8Array {
  const { cards, notes } = input;
  const now = input.now ?? (() => new Date());

  // 只导出被卡片引用的原文，避免整库体积膨胀
  const usedSourceIds = [...new Set(cards.map((c) => c.sourceId))];
  const noteFiles = new Map<string, Uint8Array>();
  for (const sid of usedSourceIds) {
    const raw = notes.get(sid);
    if (raw == null) continue; // 缺原文则该卡片的逐字无法在导入端复核，跳过其原文但卡片仍导出
    noteFiles.set(`notes/${sid}.md`, strToU8(raw));
  }

  const cardsBytes = strToU8(
    cards.map((c) => JSON.stringify(c)).join('\n') + (cards.length ? '\n' : '')
  );

  // fflate 的 zipSync 接收普通对象（不接受 Map）
  const fileMap: Record<string, Uint8Array> = { 'cards.jsonl': cardsBytes };
  for (const [name, bytes] of noteFiles) fileMap[name] = bytes;

  const manifest: ExportManifest = {
    format: 'yantian-bundle',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now().toISOString(),
    tool: 'yantian-p1',
    counts: { cards: cards.length, notes: noteFiles.size },
    files: Object.entries(fileMap).map(([path, bytes]) => ({ path, sha256: sha256(bytes), bytes: bytes.length })),
  };
  fileMap['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  return zipSync(fileMap, { level: 6 });
}

export interface ImportReport {
  ok: boolean;
  errors: string[];
  manifest: ExportManifest;
  importedCards: number;
  skippedDuplicates: number;
  notesRecovered: number;
  /** 合并后的完整卡片存储 */
  store: CardStore;
}

/**
 * 导入导出包。
 * existing 为当前卡片存储（用于幂等合并），传入 new CardStore() 表示全新导入。
 */
export function importBundle(zipBytes: Uint8Array, existing: CardStore): ImportReport {
  const errors: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch (e) {
    return { ok: false, errors: ['zip 解压失败：' + (e instanceof Error ? e.message : String(e))],
      manifest: {} as ExportManifest, importedCards: 0, skippedDuplicates: 0, notesRecovered: 0, store: existing };
  }

  // 读 manifest
  if (!files['manifest.json']) {
    return { ok: false, errors: ['缺少 manifest.json'],
      manifest: {} as ExportManifest, importedCards: 0, skippedDuplicates: 0, notesRecovered: 0, store: existing };
  }
  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json'])) as ExportManifest;
  } catch {
    return { ok: false, errors: ['manifest.json 解析失败'],
      manifest: {} as ExportManifest, importedCards: 0, skippedDuplicates: 0, notesRecovered: 0, store: existing };
  }
  if (manifest.format !== 'yantian-bundle' || manifest.version !== EXPORT_FORMAT_VERSION) {
    errors.push(`不兼容的包格式/版本：${manifest.format} v${manifest.version}`);
  }

  // 逐文件 SHA256 校验
  for (const f of manifest.files) {
    const bytes = files[f.path];
    if (!bytes) { errors.push(`缺少文件：${f.path}`); continue; }
    if (sha256(bytes) !== f.sha256) errors.push(`校验失败（SHA256 不符）：${f.path}`);
  }
  if (errors.length) {
    return { ok: false, errors, manifest, importedCards: 0, skippedDuplicates: 0, notesRecovered: 0, store: existing };
  }

  // 恢复原文 → sourceId → body 映射
  const noteBodies = new Map<string, string>();
  for (const name of Object.keys(files)) {
    if (!name.startsWith('notes/') || !name.endsWith('.md')) continue;
    const raw = strFromU8(files[name]);
    const sid = name.slice('notes/'.length, -'.md'.length);
    const note = parseSharedNote(raw, { filePath: `notes/${sid}.md`, mapTopics: false });
    noteBodies.set(note.sourceId, note.body);
  }

  // 解析卡片
  let cardText = '';
  if (files['cards.jsonl']) cardText = strFromU8(files['cards.jsonl']);
  const incoming: MaterialCard[] = [];
  for (const line of cardText.split('\n')) {
    if (!line.trim()) continue;
    try { incoming.push(JSON.parse(line) as MaterialCard); } catch { /* 跳过损坏行 */ }
  }

  // 逐张校验并入库
  let imported = 0, dup = 0;
  const merged = new CardStore(existing.all());
  for (const card of incoming) {
    const body = noteBodies.get(card.sourceId);
    // 逐字约束：有原文则强制复核；无原文则只能靠 shape + 出处
    if (body != null) {
      const v = verifyVerbatim(card.content, body);
      if (!v.ok) { errors.push(`卡片 ${card.cardId.slice(0, 8)} 逐字校验失败：${v.errors.join(';')}`); continue; }
    }
    if (!card.origin?.url?.trim()) { errors.push(`卡片 ${card.cardId.slice(0, 8)} 缺少出处`); continue; }
    const before = merged.size;
    const res = merged.add(card, body ?? card.content); // 无原文时以自身内容放行（shape 仍校验）
    if (res.ok) {
      if (merged.size > before) imported++;
    } else if (res.errors.some((e) => e.includes('重复'))) {
      dup++;
    } else {
      errors.push(`卡片 ${card.cardId.slice(0, 8)} 入库失败：${res.errors.join(';')}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    manifest,
    importedCards: imported,
    skippedDuplicates: dup,
    notesRecovered: noteBodies.size,
    store: merged,
  };
}

/** 手动导入通道输入 */
export interface ManualImportInput {
  note: SharedNote;
  type: MaterialType;
  content: string;
  topics?: ExamTopic[];
  scenes?: Scene[];
  extractorVersion?: string;
}

/**
 * 手动导入：用户从原文里选中一段作为素材。
 * 逐字约束仍强制 —— content 必须是笔记 body 的逐字子串。
 */
export function manualImport(input: ManualImportInput): { ok: boolean; card?: MaterialCard; errors: string[] } {
  const errors: string[] = [];
  const v = verifyVerbatim(input.content, input.note.body);
  if (!v.ok) errors.push(...v.errors);
  if (!input.note.origin.url?.trim()) errors.push('笔记缺少 source_url，无法强制出处');
  if (errors.length) return { ok: false, errors };

  const excerptLoc = locateExcerpt(input.content, input.note.body);
  const sourceExcerpt = input.note.body.slice(
    Math.max(0, excerptLoc.charStart - 40),
    excerptLoc.charStart + input.content.trim().length + 40
  );

  // 复用 P0 的 createCard（内部生成 UUID、状态 candidate、confirmedBy=human），避免逻辑漂移
  const card = createCard({
    sourceId: input.note.sourceId,
    type: input.type,
    content: input.content,
    sourceExcerpt,
    excerptLoc,
    origin: originFromNote(input.note),
    topics: input.topics,
    scenes: input.scenes,
    extractorVersion: input.extractorVersion,
  }, input.note);
  return { ok: true, card, errors: [] };
}
