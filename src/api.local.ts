// 本地 API 实现：接口签名与 src/api.ts (REST) 完全一致
// 这样 UI 层（data.tsx / screens）零改动即可从"联机版"切换到"离线移动版"。

import * as K from './local/kernel';
import { getWebDavConfig, isWebDavConfigured, listRemote, downloadNote, uploadNote, uploadAll, testConnection, setWebDavConfig, type WebDavConfig } from './local/webdav';
import { noteStore } from './local/store';
import type { SharedNote } from './types';

async function delay<T>(v: T, ms = 0): Promise<T> {
  if (ms) await new Promise(r => setTimeout(r, ms));
  return v;
}

export const api = {
  health: () => delay({ ok: true, name: 'yantian-mobile', version: '0.4.0-local' }),
  stats: () => K.stats(),
  scan: async () => {
    // 若配置了坚果云：拉取远端 library/*.md，新增/更新到本地
    const cfg = await getWebDavConfig();
    let added = 0, updated = 0, removed = 0;
    if (isWebDavConfigured(cfg)) {
      try {
        const remote = await listRemote(cfg);
        for (const name of remote) {
          const raw = await downloadNote(name, cfg);
          const exist = (await noteStore.list()).find(n => n.filePath.split('/').pop() === name);
          if (exist) {
            if (exist.raw !== raw) { await noteStore.save({ ...exist, raw }); updated++; }
          } else {
            const sourceId = name.replace(/\.md$/i, '');
            await noteStore.save({ sourceId, filePath: `library/${name}`, raw, createdAt: new Date().toISOString() });
            added++;
          }
        }
      } catch { /* 同步失败不阻断本地使用 */ }
    }
    return { added, updated, removed };
  },
  search: (q: string, filters: Record<string, string> = {}) => K.search(q, filters),
  notes: async (sourceId: string): Promise<SharedNote> => {
    const stored = await noteStore.get(sourceId);
    if (!stored) throw new Error('未找到笔记');
    return K.toSharedNote(stored);
  },
  topics: () => K.topics(),
  bundle: (topic?: string) => K.bundle(topic),
  review: () => K.review(),
  cards: () => K.cards(),
  listNotes: () => K.listNotes(),
  manualCard: (body: { sourceId: string; content: string; type: string; topics?: string[]; scenes?: string[] }) =>
    K.addCard({ ...body, confirm: false }),
  confirmCard: (body: { sourceId: string; content: string; type: string; topics?: string[]; scenes?: string[] }) =>
    K.addCard({ ...body, confirm: true }),
  extract: (sourceId: string) => K.extract(sourceId),
  setStatus: (id: string, status: string) => K.setCardStatus(id, status as never),
  setMastery: (id: string, mastery: string) => K.setCardMastery(id, mastery as never),
  exportBundle: () => K.exportBundleBase64(),
  importBundle: (base64: string) => K.importBundleBase64(base64),

  // ===== 移动端新增能力（UI 里通过扩展调用） =====
  /** 采集一篇笔记（写 md），可选立即上传坚果云 */
  upsertNote: async (input: { title: string; body: string; site?: string; author?: string; url?: string; tags?: string[]; upload?: boolean }) => {
    const note = await K.upsertNote(input);
    if (input.upload) {
      const cfg = await getWebDavConfig();
      if (isWebDavConfigured(cfg)) {
        const stored = await noteStore.get(note.sourceId);
        if (stored) await uploadNote(stored, cfg).catch(() => {});
      }
    }
    return note;
  },
  webdav: {
    getConfig: getWebDavConfig,
    setConfig: async (cfg: WebDavConfig) => setWebDavConfig(cfg),
    test: testConnection,
    uploadAll,
    listRemote,
  },
};
