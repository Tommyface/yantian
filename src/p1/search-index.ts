/**
 * SQLite FTS5 检索层
 *
 * 选型：Node 自带的 node:sqlite（Node 24+，内置 FTS5 trigram）。
 *  - trigram 按 3 字符切分，天然支持中文子串匹配（如“基层治理”命中长句）。
 *  - 零原生依赖：信创环境（UOS V20 / glibc 2.28）下预编译原生模块对不上 glibc，
 *    改用 Node 内置 SQLite 后整个应用不再有任何 .node 产物，跨发行版更稳。
 *
 * 架构：
 *  - notes / cards 主表存完整对象（JSON），FTS 虚表只存检索列 + UNINDEXED id。
 *  - FTS 负责全文召回，多维过滤（type/topics/scenes/status）在内存对候选集过滤，
 *    职责清晰、避免 SQL 拼接 JSON 的脆弱性。
 *  - 事实源仍是 cards.jsonl 与 library/*.md，本库是可随时重建的派生索引。
 */

import { DatabaseSync } from 'node:sqlite';
type DatabaseType = InstanceType<typeof DatabaseSync>;
import type { SharedNote, MaterialCard, MaterialType, CompileStatus, ExamTopic, Scene } from '../contracts/index.js';

export interface SearchHit {
  kind: 'note' | 'card';
  id: string;
  score: number;
  title: string;
  snippet: string;
  site: string;
  sourceId: string;
  note?: SharedNote;
  card?: MaterialCard;
}

export interface SearchFilters {
  kind?: 'note' | 'card';
  type?: MaterialType;
  status?: CompileStatus;
  topics?: ExamTopic[];
  scenes?: Scene[];
  site?: string;
  limit?: number;
}

export interface IndexStats {
  notes: number;
  cards: number;
  noteFts: number;
  cardFts: number;
}

/** 转义 FTS5 MATCH 查询串：包成短语并转义内部双引号，避免语法错误/注入 */
export function toFtsQuery(text: string): string {
  const cleaned = text.replace(/"/g, '""').trim();
  return cleaned ? `"${cleaned}"` : '""';
}

export class SearchIndex {
  private db: DatabaseType;

  constructor(path: string = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.createSchema();
  }

  /** 事务包装（node:sqlite 没有 .transaction 助手，手动 BEGIN/COMMIT；支持嵌套调用） */
  private inTx = false;
  private tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      this.inTx = false;
    }
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        source_id TEXT PRIMARY KEY,
        site TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cards (
        card_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        site TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        source_id UNINDEXED, title, body, site,
        tokenize = 'trigram'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
        card_id UNINDEXED, content, excerpt, site,
        tokenize = 'trigram'
      );
    `);
  }

  /** 索引（或更新）一篇笔记 */
  indexNote(note: SharedNote): void {
    const payload = JSON.stringify(note);
    const site = note.front.site ?? '';
    this.tx(() => {
      this.db.prepare(`INSERT INTO notes(source_id, site, payload) VALUES(?,?,?)
        ON CONFLICT(source_id) DO UPDATE SET site=excluded.site, payload=excluded.payload`)
        .run(note.sourceId, site, payload);
      // FTS 更新：先删后插（无 UPSERT）
      this.db.prepare(`DELETE FROM notes_fts WHERE source_id = ?`).run(note.sourceId);
      this.db.prepare(`INSERT INTO notes_fts(source_id, title, body, site) VALUES(?,?,?,?)`)
        .run(note.sourceId, note.front.title ?? '', note.body, site);
    });
  }

  /** 批量索引笔记 */
  indexNotes(notes: SharedNote[]): void {
    this.tx(() => notes.forEach((n) => this.indexNote(n)));
  }

  /** 索引（或更新）一张卡片 */
  indexCard(card: MaterialCard): void {
    const payload = JSON.stringify(card);
    const site = card.origin.site ?? '';
    this.tx(() => {
      this.db.prepare(`INSERT INTO cards(card_id, source_id, type, status, site, payload)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(card_id) DO UPDATE SET source_id=excluded.source_id, type=excluded.type,
          status=excluded.status, site=excluded.site, payload=excluded.payload`)
        .run(card.cardId, card.sourceId, card.type, card.status, site, payload);
      this.db.prepare(`DELETE FROM cards_fts WHERE card_id = ?`).run(card.cardId);
      this.db.prepare(`INSERT INTO cards_fts(card_id, content, excerpt, site) VALUES(?,?,?,?)`)
        .run(card.cardId, card.content, card.sourceExcerpt, site);
    });
  }

  indexCards(cards: MaterialCard[]): void {
    this.tx(() => cards.forEach((c) => this.indexCard(c)));
  }

  /** 删除某来源的全部索引（配合原文删除） */
  removeSource(sourceId: string): void {
    this.tx(() => {
      const cardIds = (this.db.prepare('SELECT card_id FROM cards WHERE source_id=?').all(sourceId) as Array<{card_id:string}>).map(r=>r.card_id);
      for (const id of cardIds) this.db.prepare('DELETE FROM cards_fts WHERE card_id=?').run(id);
      this.db.prepare('DELETE FROM cards WHERE source_id=?').run(sourceId);
      this.db.prepare('DELETE FROM notes_fts WHERE source_id=?').run(sourceId);
      this.db.prepare('DELETE FROM notes WHERE source_id=?').run(sourceId);
    });
  }

  /**
   * 全文检索 + 多维过滤。
   * query 为空时按过滤条件列出全部（分页 limit）。
   */
  search(query: string, filters: SearchFilters = {}): SearchHit[] {
    const hits: SearchHit[] = [];
    const limit = filters.limit ?? 50;
    const q = query.trim() ? toFtsQuery(query) : null;

    // --- 笔记召回 ---
    if (filters.kind !== 'card') {
      let noteRows: Array<{ source_id: string; snippet: string; score: number; site: string }>;
      if (q) {
        noteRows = this.db.prepare(`
          SELECT f.source_id,
                 snippet(notes_fts, 2, '«', '»', '…', 18) AS snippet,
                 bm25(notes_fts, 0.0, 2.0, 1.0, 0.5) AS score,
                 n.site
          FROM notes_fts f JOIN notes n ON n.source_id = f.source_id
          WHERE notes_fts MATCH ?
          ORDER BY score
        `).all(q) as typeof noteRows;
      } else {
        noteRows = this.db.prepare(`
          SELECT n.source_id, substr(n.payload,1,120) AS snippet, 0.0 AS score, n.site
          FROM notes n ORDER BY n.source_id
        `).all() as typeof noteRows;
      }
      for (const row of noteRows) {
        if (filters.site && row.site !== filters.site) continue;
        const note = this.getNote(row.source_id);
        if (!note) continue;
        hits.push({
          kind: 'note', id: row.source_id,
          score: row.score, snippet: row.snippet, site: row.site,
          sourceId: row.source_id, title: note.front.title ?? '(无标题)', note,
        });
      }
    }

    // --- 卡片召回 ---
    if (filters.kind !== 'note') {
      let cardRows: Array<{ card_id: string; snippet: string; score: number }>;
      if (q) {
        cardRows = this.db.prepare(`
          SELECT card_id,
                 snippet(cards_fts, 1, '«', '»', '…', 16) AS snippet,
                 bm25(cards_fts, 0.0, 2.0, 1.0, 0.5) AS score
          FROM cards_fts WHERE cards_fts MATCH ? ORDER BY score
        `).all(q) as typeof cardRows;
      } else {
        cardRows = this.db.prepare(`SELECT card_id, '' AS snippet, 0.0 AS score FROM cards`).all() as typeof cardRows;
      }
      for (const row of cardRows) {
        const card = this.getCard(row.card_id);
        if (!card) continue;
        if (filters.type && card.type !== filters.type) continue;
        if (filters.status && card.status !== filters.status) continue;
        if (filters.site && card.origin.site !== filters.site) continue;
        if (filters.topics?.length && !filters.topics.some((t) => card.topics.includes(t))) continue;
        if (filters.scenes?.length && !filters.scenes.some((s) => card.scenes.includes(s))) continue;
        hits.push({
          kind: 'card', id: card.cardId,
          score: row.score, snippet: row.snippet || card.content.slice(0, 80),
          site: card.origin.site, sourceId: card.sourceId,
          title: card.content.slice(0, 40), card,
        });
      }
    }

    // FTS 分数越小越相关（bm25 为负）；统一按相关性升序
    hits.sort((a, b) => a.score - b.score);
    return hits.slice(0, limit);
  }

  getNote(sourceId: string): SharedNote | null {
    const row = this.db.prepare('SELECT payload FROM notes WHERE source_id=?').get(sourceId) as {payload:string} | undefined;
    return row ? JSON.parse(row.payload) as SharedNote : null;
  }

  getCard(cardId: string): MaterialCard | null {
    const row = this.db.prepare('SELECT payload FROM cards WHERE card_id=?').get(cardId) as {payload:string} | undefined;
    return row ? JSON.parse(row.payload) as MaterialCard : null;
  }

  stats(): IndexStats {
    const one = (sql: string) => (this.db.prepare(sql).get() as {n:number}).n;
    return {
      notes: one('SELECT count(*) AS n FROM notes'),
      cards: one('SELECT count(*) AS n FROM cards'),
      noteFts: one('SELECT count(*) AS n FROM notes_fts'),
      cardFts: one('SELECT count(*) AS n FROM cards_fts'),
    };
  }

  /** 清空所有索引（重建前调用） */
  clear(): void {
    this.db.exec(`DELETE FROM notes_fts; DELETE FROM notes; DELETE FROM cards_fts; DELETE FROM cards;`);
  }

  close(): void {
    this.db.close();
  }
}
