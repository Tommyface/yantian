/**
 * 共享库递归扫描与增量入库 (Vault Scanner)
 *
 * 职责：扫描拾页产出的 library/**\/*.md，解析为 SharedNote，
 * 通过内容指纹对比清单，识别「新增 / 更新 / 删除」，产出增量报告。
 *
 * 铁律（联动架构原则）：
 *  - 只读 —— 绝不修改、重命名、删除 library 下任何拾页原文。
 *  - 砚田只在 vault/.yantian/ 下写自己的清单文件。
 *  - 指纹基于文件原始字节，任何改动（哪怕一个字）都会触发更新。
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { parseSharedNote } from '../p0/parse-shared-note.js';
import type { SharedNote } from '../contracts/index.js';

/** 单条笔记的清单记录 */
export interface ManifestEntry {
  /** 相对 vault 根的路径（唯一键） */
  filePath: string;
  /** source_id */
  sourceId: string;
  /** 文件原始字节的 sha256 */
  fingerprint: string;
  /** front matter 的 content_hash（拾页自报，可能缺失） */
  contentHash: string;
  /** 首次扫描时间 ISO */
  firstSeenAt: string;
  /** 最近一次内容变更时间 ISO */
  lastSeenAt: string;
}

/** 扫描清单（持久化到 vault/.yantian/scan-manifest.json） */
export interface ScanManifest {
  version: 1;
  /** 上次全量扫描时间 */
  lastScanAt: string;
  /** key = filePath */
  entries: Record<string, ManifestEntry>;
}

/** 增量动作 */
export type ScanAction = 'added' | 'updated' | 'unchanged' | 'removed';

/** 单条扫描结果 */
export interface ScanResultItem {
  filePath: string;
  sourceId: string;
  action: ScanAction;
  note?: SharedNote;
  /** 变更说明 */
  detail?: string;
}

/** 扫描报告 */
export interface ScanReport {
  scannedAt: string;
  totalFiles: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  /** 解析失败的文件（不中断整体扫描） */
  errors: Array<{ filePath: string; error: string }>;
  items: ScanResultItem[];
}

/** 计算字节指纹 */
export function fingerprintOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** 默认清单路径 */
export function defaultManifestPath(vaultRoot: string): string {
  return join(vaultRoot, '.yantian', 'scan-manifest.json');
}

/** 空清单 */
export function emptyManifest(): ScanManifest {
  return { version: 1, lastScanAt: '', entries: {} };
}

/** 读取清单（不存在返回空） */
export async function loadManifest(path: string): Promise<ScanManifest> {
  if (!existsSync(path)) return emptyManifest();
  try {
    const data = JSON.parse(await readFile(path, 'utf-8')) as ScanManifest;
    if (data.version !== 1 || typeof data.entries !== 'object') return emptyManifest();
    return data;
  } catch {
    // 清单损坏时降级为空，重新全量扫描（原文不受影响）
    return emptyManifest();
  }
}

/** 写入清单（自动建目录） */
export async function saveManifest(path: string, manifest: ScanManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/** 递归收集目录下所有 .md 文件的绝对路径 */
export async function collectMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true }) as Dirent<string>[];
    } catch {
      return; // 目录不存在或不可读，跳过
    }
    for (const e of entries) {
      // 跳过砚田自己的目录与隐藏目录
      if (e.name.startsWith('.') && e.isDirectory()) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out.sort();
}

/** 路径归一化为 POSIX 风格（跨平台一致的清单键） */
function toPosix(p: string): string {
  return p.split(sep).join('/');
}

export interface ScanOptions {
  /** vault 根目录 */
  vaultRoot: string;
  /** 扫描子目录（相对 vault 根，默认 library） */
  scanDir?: string;
  /** 清单路径（默认 vaultRoot/.yantian/scan-manifest.json） */
  manifestPath?: string;
  /** 是否把拾页标签映射为遴选主题（透传给解析器） */
  mapTopics?: boolean;
  /** 扫描完成后是否写回清单（测试时可传 false） */
  persist?: boolean;
  /** 注入时钟（便于测试确定性） */
  now?: () => Date;
}

/**
 * 执行一次增量扫描。
 * 返回报告并（默认）持久化新清单。原文绝不改动。
 */
export async function scanVault(options: ScanOptions): Promise<ScanReport> {
  const {
    vaultRoot,
    scanDir = 'library',
    manifestPath = defaultManifestPath(vaultRoot),
    mapTopics = true,
    persist = true,
    now = () => new Date(),
  } = options;

  const scanRoot = join(vaultRoot, scanDir);
  const files = await collectMarkdownFiles(scanRoot);
  const oldManifest = await loadManifest(manifestPath);
  const newEntries: Record<string, ManifestEntry> = {};
  const items: ScanResultItem[] = [];
  const errors: ScanReport['errors'] = [];
  const seen = new Set<string>();
  let added = 0, updated = 0, unchanged = 0;

  for (const abs of files) {
    const rel = toPosix(relative(vaultRoot, abs));
    seen.add(rel);
    try {
      const bytes = await readFile(abs);
      const fp = fingerprintOf(bytes);
      const raw = bytes.toString('utf-8');
      const note = parseSharedNote(raw, { filePath: rel, mapTopics });
      const prev = oldManifest.entries[rel];
      const ts = now().toISOString();

      let action: ScanAction;
      let detail: string | undefined;
      if (!prev) {
        action = 'added';
        added++;
        detail = '首次发现';
      } else if (prev.fingerprint !== fp) {
        action = 'updated';
        updated++;
        detail = `内容变更 ${prev.fingerprint.slice(0, 8)} → ${fp.slice(0, 8)}`;
      } else {
        action = 'unchanged';
        unchanged++;
      }

      newEntries[rel] = {
        filePath: rel,
        sourceId: note.sourceId,
        fingerprint: fp,
        contentHash: note.front.content_hash ?? '',
        firstSeenAt: prev?.firstSeenAt ?? ts,
        lastSeenAt: action === 'unchanged' ? (prev?.lastSeenAt ?? ts) : ts,
      };
      items.push({ filePath: rel, sourceId: note.sourceId, action, note: action === 'unchanged' ? undefined : note, detail });
    } catch (e) {
      errors.push({ filePath: rel, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 检测已删除（旧清单有、本次未出现）
  let removed = 0;
  for (const [rel, prev] of Object.entries(oldManifest.entries)) {
    if (!seen.has(rel)) {
      removed++;
      items.push({ filePath: rel, sourceId: prev.sourceId, action: 'removed', detail: '原文已从库中移除' });
    }
  }

  const report: ScanReport = {
    scannedAt: now().toISOString(),
    totalFiles: files.length,
    added, updated, unchanged, removed,
    errors,
    items,
  };

  if (persist) {
    await saveManifest(manifestPath, {
      version: 1,
      lastScanAt: report.scannedAt,
      entries: newEntries,
    });
  }

  return report;
}

/** 只取需要入库的笔记（新增 + 更新），供上层索引消费 */
export function changedNotes(report: ScanReport): SharedNote[] {
  return report.items
    .filter((it) => (it.action === 'added' || it.action === 'updated') && it.note)
    .map((it) => it.note!);
}
