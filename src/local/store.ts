// 本地存储抽象层
// - 浏览器环境：localStorage（可在此环境完整验证）
// - Capacitor 环境：Filesystem 插件写到 App 私有目录（数据不出本机）
// 事实源是纯文本 md（notes）+ JSONL（cards），索引可随时重建。

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const IS_NATIVE = Capacitor.isNativePlatform();
const LS_PREFIX = 'yantian:';
const FS_DIR = Directory.Data;           // App 私有数据目录，不进公共存储
const NOTES_DIR = 'vault/library';
const CARDS_FILE = 'vault/.yantian/cards.jsonl';

export interface StoredNote {
  sourceId: string;
  filePath: string;
  raw: string; // 完整 md（含 front matter）
  createdAt: string;
}

/** 统一 KV 存储：native 用文件，浏览器用 localStorage */
export const kv = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      if (IS_NATIVE) {
        const { data } = await Filesystem.readFile({ path: `${key}.json`, directory: FS_DIR, encoding: Encoding.UTF8 });
        return JSON.parse(String(data)) as T;
      }
      const s = localStorage.getItem(LS_PREFIX + key);
      return s ? JSON.parse(s) as T : fallback;
    } catch {
      return fallback;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    if (IS_NATIVE) {
      await Filesystem.writeFile({ path: `${key}.json`, directory: FS_DIR, data: JSON.stringify(value), encoding: Encoding.UTF8 });
    } else {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    }
  },
  async remove(key: string): Promise<void> {
    try {
      if (IS_NATIVE) await Filesystem.deleteFile({ path: `${key}.json`, directory: FS_DIR });
      else localStorage.removeItem(LS_PREFIX + key);
    } catch { /* ignore */ }
  },
};

/** 原始笔记（md 文件）读写 */
export const noteStore = {
  async list(): Promise<StoredNote[]> {
    return kv.get<StoredNote[]>('notes', []);
  },
  async save(note: StoredNote): Promise<void> {
    const all = await this.list();
    const idx = all.findIndex(n => n.sourceId === note.sourceId);
    if (idx >= 0) all[idx] = note; else all.push(note);
    await kv.set('notes', all);
    // 同时写一份 md 到 App 私有目录（事实源，可被 WebDAV 同步）
    if (IS_NATIVE) {
      try {
        await Filesystem.writeFile({
          path: `${NOTES_DIR}/${note.filePath.split('/').pop() || note.sourceId + '.md'}`,
          directory: FS_DIR, data: note.raw, encoding: Encoding.UTF8, recursive: true,
        });
      } catch { /* 文件写失败不影响主流程，索引仍在 */ }
    }
  },
  async remove(sourceId: string): Promise<void> {
    const all = (await this.list()).filter(n => n.sourceId !== sourceId);
    await kv.set('notes', all);
  },
  async get(sourceId: string): Promise<StoredNote | undefined> {
    return (await this.list()).find(n => n.sourceId === sourceId);
  },
};

/** 读取 App 私有目录下的 md 文件文本（native） */
export async function readNativeNoteFile(name: string): Promise<string | null> {
  if (!IS_NATIVE) return null;
  try {
    const { data } = await Filesystem.readFile({ path: `${NOTES_DIR}/${name}`, directory: FS_DIR, encoding: Encoding.UTF8 });
    return String(data);
  } catch { return null; }
}

/** 列出 App 私有目录 import/ 下的待导入文件（供 WebDAV 下载后使用） */
export async function listImportFiles(): Promise<string[]> {
  if (!IS_NATIVE) return [];
  try {
    const { files } = await Filesystem.readdir({ path: NOTES_DIR, directory: FS_DIR });
    return files.filter(f => f.name.endsWith('.md')).map(f => f.name);
  } catch { return []; }
}

export { IS_NATIVE, CARDS_FILE, NOTES_DIR };
