/**
 * 应用状态层 (AppState)
 *
 * 统一封装砚田的持久化状态，是 HTTP 服务层的单一入口：
 *  - vault 根路径与文件布局
 *  - cards.jsonl（卡片事实源）
 *  - SQLite FTS5 索引（可重建派生数据）
 *  - 扫描清单
 *
 * 关键协调逻辑 syncFromVault()：
 *   扫拾页库 → 新增/更新的笔记补进索引；删除的来源从索引清除。
 *   卡片不随原文删除而删除（保留用户已沉淀的素材，仅标注出处原文缺失）。
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CardStore } from '../p0/material-card.js';
import { SearchIndex } from '../p1/search-index.js';
import { scanVault } from '../p1/vault-scanner.js';
import type { MaterialCard, SharedNote } from '../contracts/index.js';
import type { ScanReport } from '../p1/vault-scanner.js';

export interface AppPaths {
  vaultRoot: string;
  /** 卡片事实源，默认 vault/.yantian/cards.jsonl */
  cardsPath: string;
  /** SQLite 索引，默认 vault/.yantian/index.sqlite */
  indexPath: string;
}

export interface AppStats {
  notes: number;
  cards: number;
  notesFts: number;
  cardsFts: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byTopic: Record<string, number>;
}

/** 根据 vault 根推导默认路径 */
export function defaultPaths(vaultRoot: string): AppPaths {
  return {
    vaultRoot,
    cardsPath: join(vaultRoot, '.yantian', 'cards.jsonl'),
    indexPath: join(vaultRoot, '.yantian', 'index.sqlite'),
  };
}

export class AppState {
  readonly paths: AppPaths;
  cards: CardStore;
  index: SearchIndex;

  private constructor(paths: AppPaths, cards: CardStore, index: SearchIndex) {
    this.paths = paths;
    this.cards = cards;
    this.index = index;
  }

  /** 异步打开应用状态（加载卡片、重建索引连接） */
  static async open(vaultRoot: string, paths?: AppPaths): Promise<AppState> {
    const p = paths ?? defaultPaths(vaultRoot);
    await mkdir(dirname(p.cardsPath), { recursive: true });

    // 加载卡片事实源
    let cards = new CardStore();
    if (existsSync(p.cardsPath)) {
      cards = CardStore.fromJSONL(await readFile(p.cardsPath, 'utf-8'));
    }
    // 打开/新建索引
    const index = new SearchIndex(p.indexPath);
    const app = new AppState(p, cards, index);

    // 若索引为空但卡片有数据（如首次运行或索引被删），从卡片回填索引
    const st = index.stats();
    if (st.cards === 0 && cards.size > 0) app.reindexCards();

    return app;
  }

  /** 保存卡片事实源到 jsonl */
  async saveCards(): Promise<void> {
    await writeFile(this.paths.cardsPath, this.cards.toJSONL(), 'utf-8');
  }

  /** 把当前全部卡片重建进索引 */
  reindexCards(): void {
    this.index.clear();
    this.index.indexCards(this.cards.all());
  }

  /**
   * 扫描拾页库并同步索引（不改动卡片事实源）。
   * - added/updated 的笔记 → 补进/更新笔记索引
   * - removed 的笔记 → 从索引清除（卡片保留）
   * 返回扫描报告，供上层展示。
   */
  async syncFromVault(): Promise<ScanReport> {
    const report = await scanVault({ vaultRoot: this.paths.vaultRoot });
    for (const item of report.items) {
      if ((item.action === 'added' || item.action === 'updated') && item.note) {
        this.index.indexNote(item.note);
      } else if (item.action === 'removed') {
        this.index.removeSource(item.sourceId);
      }
    }
    return report;
  }

  /** 检索（透传索引层） */
  search(query: string, filters?: Parameters<SearchIndex['search']>[1]) {
    return this.index.search(query, filters);
  }

  /** 取笔记原文（供逐字校验） */
  getNoteBody(sourceId: string): string | null {
    return this.index.getNote(sourceId)?.body ?? null;
  }

  getNote(sourceId: string): SharedNote | null {
    return this.index.getNote(sourceId);
  }

  /** 读取拾页原始 Markdown（含 front matter），用于导出包保真 */
  async readNoteRaw(sourceId: string): Promise<string | null> {
    const note = this.index.getNote(sourceId);
    if (!note) return null;
    try {
      return await readFile(join(this.paths.vaultRoot, note.filePath), 'utf-8');
    } catch {
      return null;
    }
  }

  /** 添加卡片（同时落事实源 + 索引），返回校验结果 */
  async addCard(card: MaterialCard, noteBody: string): Promise<{ ok: boolean; errors: string[] }> {
    const res = this.cards.add(card, noteBody);
    if (res.ok) {
      this.index.indexCard(card);
      await this.saveCards();
    }
    return res;
  }

  /** 更新卡片状态（事实源 + 索引） */
  async updateCardStatus(cardId: string, to: Parameters<CardStore['updateStatus']>[1]) {
    const card = this.cards.get(cardId);
    const res = this.cards.updateStatus(cardId, to);
    if (res.ok && card) {
      this.index.indexCard({ ...card, status: to });
      await this.saveCards();
    }
    return res;
  }

  /** 更新掌握度（事实源 + 索引） */
  async updateCardMastery(cardId: string, mastery: Parameters<CardStore['updateMastery']>[1]) {
    const card = this.cards.get(cardId);
    const res = this.cards.updateMastery(cardId, mastery);
    if (res.ok && card) {
      this.index.indexCard({ ...card, mastery });
      await this.saveCards();
    }
    return res;
  }

  /** 统计概览 */
  stats(): AppStats {
    const all = this.cards.all();
    const count = (fn: (c: MaterialCard) => string) =>
      all.reduce<Record<string, number>>((acc, c) => {
        const k = fn(c);
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {});
    const s = this.index.stats();
    return {
      notes: s.notes, cards: s.cards, notesFts: s.noteFts, cardsFts: s.cardFts,
      byStatus: count((c) => c.status),
      byType: count((c) => c.type),
      byTopic: all.reduce<Record<string, number>>((acc, c) => {
        for (const t of c.topics) acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }

  /** 关闭索引连接 */
  close(): void {
    this.index.close();
  }
}

/** 检查 vault 是否已初始化（存在 library 目录） */
export function isVaultReady(vaultRoot: string): boolean {
  return existsSync(join(vaultRoot, 'library'));
}
