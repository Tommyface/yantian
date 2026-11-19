// 本地 API 实现：接口签名与 src/api.ts (REST) 完全一致
// 这样 UI 层（data.tsx / screens）零改动即可从"联机版"切换到"离线移动版"。

import * as K from './local/kernel';
import { getWebDavConfig, isWebDavConfigured, listRemoteEntries, downloadNote, uploadNote, uploadAll, testConnection, setWebDavConfig, getSyncManifest, setSyncManifest, type WebDavConfig } from './local/webdav';
import { noteStore } from './local/store';
import type { SharedNote } from './types';

async function delay<T>(v: T, ms = 0): Promise<T> {
  if (ms) await new Promise(r => setTimeout(r, ms));
  return v;
}

export const api = {
  health: () => delay({ ok: true, name: 'yantian-mobile', version: '0.4.0-local' }),
  stats: () => K.stats(),
  scan: async (): Promise<{ added: number; updated: number; removed: number; skipped: number; changed: number; from: string }> => {
    // 从坚果云增量拉取拾页上传的 library/*.md：
    // 只对「云端新增 / ETag 变化 / 本地缺失」的文件发起 GET，未变化的直接跳过。
    const cfg = await getWebDavConfig();
    if (!isWebDavConfigured(cfg)) {
      // 隐患①：未配置时不再静默返回"新增 0 条"，明确报错让用户去设置。
      throw new Error('尚未配置坚果云，请先在「设置」里填写 WebDAV 地址、账号与应用专用密码');
    }

    const CLOUD = 'webdav/'; // 云端来源标记：只有这类笔记才允许被删除同步清理
    let added = 0, updated = 0, removed = 0, skipped = 0;

    // 隐患②：不再吞掉网络错误，失败直接上抛，UI 会显示真实原因。
    const remote = await listRemoteEntries(cfg);
    const remoteSet = new Set(remote.map(e => e.name));
    const manifest = await getSyncManifest();
    const localList = await noteStore.list();
    const byName = new Map(localList.map(n => [n.filePath.split('/').pop() || '', n]));

    // 拉取/更新：仅在云端文件「缺失本地副本」或「ETag 变化」时才下载。
    for (const entry of remote) {
      const name = entry.name;
      const exist = byName.get(name);
      const unchanged = !!exist && manifest.initialized && manifest.etags[name] === entry.etag;
      if (unchanged) {
        // ETag 未变且本地有副本 → 跳过，不发起 GET，避免全量拉取触发限流。
        skipped++;
        continue;
      }
      const raw = await downloadNote(name, cfg);
      if (exist) {
        if (exist.raw !== raw) { await noteStore.save({ ...exist, raw }); updated++; }
        else { updated++; }
      } else {
        const sourceId = name.replace(/\.md$/i, '');
        await noteStore.save({ sourceId, filePath: CLOUD + name, raw, createdAt: new Date().toISOString() });
        added++;
      }
      manifest.etags[name] = entry.etag;
    }

    // 删除同步：仅清理「云端来源且远端已消失」的笔记，绝不碰手动导入内容。
    // 仅当已完成过至少一次完整同步（initialized）后才执行，避免首次同步误删本地。
    if (manifest.initialized) {
      const local = await noteStore.list();
      for (const note of local) {
        if (!note.filePath.startsWith(CLOUD)) continue;
        const name = note.filePath.split('/').pop() || '';
        if (!remoteSet.has(name)) {
          await K.removeCardsOf(note.sourceId);
          await noteStore.remove(note.sourceId);
          removed++;
        }
        // 云端已消失的文件，同步清单里也清掉，避免残留
        if (!remoteSet.has(name)) delete manifest.etags[name];
      }
    }

    manifest.initialized = true;
    await setSyncManifest(manifest);

    const changed = added + updated + removed;
    return { added, updated, removed, skipped, changed, from: '坚果云' };
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
      listRemote: listRemoteEntries,
    },
};
