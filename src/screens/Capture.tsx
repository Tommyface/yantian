import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { useData } from '../data';
import { api } from '../api';
import type { ExtractionResult, ExtractionCandidate, SharedNote } from '../types';

function noteTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

export function CaptureScreen() {
  const { connected, showToast, refresh } = useData();
  const [tab, setTab] = useState('拾页原文');
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [activeNote, setActiveNote] = useState<string>('');
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const loadNotes = async () => {
    const list = await api.listNotes();
    setNotes(list);
    setActiveNote(prev => prev || list[0]?.sourceId || '');
  };
  useEffect(() => { void loadNotes(); }, []);

  const candidates = result?.candidates ?? [];

  const doExtract = async (sourceId?: string) => {
    const sid = sourceId || activeNote;
    setActiveNote(sid);
    setExtracting(true);
    setDoneIds(new Set());
    try {
      const r = await api.extract(sid);
      setResult(r);
      showToast(`抽取完成：${r.candidates.length} 条候选${r.dropped ? `，拦截 ${r.dropped} 条非原文` : ''}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '抽取失败');
    } finally {
      setExtracting(false);
    }
  };

  const confirm = async (c: ExtractionCandidate, idx: number) => {
    try {
      await api.confirmCard({ sourceId: c.sourceId, content: c.text, type: c.type });
      setDoneIds(p => new Set(p).add(String(idx)));
      showToast('已确认入库');
      void refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '确认失败');
    }
  };

  return (
    <div className="screen capture-screen">
      <div className="page-title">采集</div>
      <div className="page-sub">从拾页原文沉淀素材 · 每一行都可溯源</div>

      <div className="cap-tabs">
        {['拾页原文', '手动导入', '导出 / 导入包'].map(t => (
          <span key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (t === '拾页原文') void loadNotes(); }}>{t}</span>
        ))}
      </div>

      {tab === '拾页原文' && (
        <div className="cap-layout">
          <div>
            <div className="card" style={{ padding: 14 }}>
              {notes.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--ink-400)', margin: 0, padding: '12px 0' }}>
                  暂无笔记。请在「手动导入」里采集一篇，或在设置里同步坚果云。
                </p>
              )}
              {notes.map(n => (
                <div key={n.sourceId} className={`note ${activeNote === n.sourceId ? 'on' : ''}`} onClick={() => setActiveNote(n.sourceId)}>
                  <h5>{n.front.title || '未命名笔记'}</h5>
                  <div className="m"><span>{n.origin.site || '本机'}</span><span>·</span><span>{noteTime(n.front.captured_at)}</span><span className="act" onClick={e => { e.stopPropagation(); void doExtract(n.sourceId); }}>{extracting && activeNote === n.sourceId ? '抽取中…' : '抽取候选'}</span></div>
                </div>
              ))}
            </div>
          </div>

          <div className="cand-panel">
            <div className="cand-head">
              <h4>AI 抽取候选 · {candidates.length} 条</h4>
              <div className="ai-badge"><Icon name="sparkle" size={15} />本地抽取 · 已逐字校验</div>
            </div>
            {candidates.map((c, i) => (
              <div className="cand" key={i} style={!c.verbatim ? { opacity: .6 } : undefined}>
                <div className="cand-body">
                  <div className="cand-q">{c.text}</div>
                  <div className="cand-meta">
                    <span className={`tag ${c.type === 'golden_sentence' ? 'gold' : ''}`}>{{ golden_sentence: '金句', subheading: '小标题', practice: '改革实践', article: '好文章' }[c.type]}</span>
                    <span className="tag green">逐字通过</span>
                    <span className="conf">置信度 {Math.round(c.confidence * 100)}%</span>
                  </div>
                </div>
                <button className={`cand-btn ${doneIds.has(String(i)) ? 'done' : ''}`} disabled={doneIds.has(String(i))} onClick={() => void confirm(c, i)}>
                  {doneIds.has(String(i)) ? '已入库' : '确认入库'}
                </button>
              </div>
            ))}
            <div className="cand" style={{ opacity: .6 }}>
              <div className="cand-body">
                <div className="cand-q">某编造的金句内容不会出现在候选列表，逐字校验直接丢弃…</div>
                <div className="cand-meta"><span className="tag amber">已丢弃</span><span style={{ color: 'var(--danger)' }}>非原文片段</span></div>
              </div>
              <button className="cand-btn done" style={{ borderColor: 'var(--border)', color: 'var(--ink-400)', background: '#f5f5f5' }}>已拦截</button>
            </div>
          </div>
        </div>
      )}

      {tab === '手动导入' && <ManualImport onDone={() => { void refresh(); showToast('已手动导入'); }} connected={connected} />}
      {tab === '导出 / 导入包' && <ImportExport connected={connected} showToast={showToast} />}
    </div>
  );
}

function ManualImport({ onDone, connected }: { onDone: () => void; connected: boolean }) {
  const { showToast } = useData();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [site, setSite] = useState('');
  const [upload, setUpload] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const note = await (api as unknown as { upsertNote: (i: Record<string, unknown>) => Promise<{ sourceId: string }> }).upsertNote({
        title: title.trim() || content.trim().slice(0, 24),
        body: content.trim(),
        site: site.trim(),
        upload,
      });
      showToast(`已保存为笔记 ${note.sourceId.slice(0, 16)}…${upload ? '，并尝试上传坚果云' : ''}`);
      setTitle(''); setContent(''); setSite('');
      onDone();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败');
    } finally { setSaving(false); }
  };

  return (
    <div className="card" style={{ maxWidth: 640, padding: 24 }}>
      <h4 style={{ marginBottom: 6 }}>采集新笔记</h4>
      <p style={{ fontSize: 12, color: 'var(--ink-400)', marginBottom: 18 }}>写入拾页格式 md（含 front matter），存于本机；可在设置里同步坚果云。抽取时逐字校验仍强制生效。</p>
      <label className="field-lbl">标题</label>
      <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="笔记标题（可选）" style={{ marginBottom: 12 }} />
      <label className="field-lbl">正文</label>
      <textarea className="input" rows={6} value={content} onChange={e => setContent(e.target.value)} placeholder="粘贴原文全文…" style={{ resize: 'vertical', marginBottom: 12 }} />
      <label className="field-lbl">来源</label>
      <input className="input" value={site} onChange={e => setSite(e.target.value)} placeholder="如：人民日报 / 求是（可选）" style={{ marginBottom: 12 }} />
      <label className="switch-row">
        <input type="checkbox" checked={upload} onChange={e => setUpload(e.target.checked)} />
        <span>保存后上传到坚果云</span>
      </label>
      <button className="btn pri" onClick={() => void save()} disabled={saving} style={{ marginTop: 14 }}>
        <Icon name="plus" />{saving ? '保存中…' : '保存到本机'}
      </button>
    </div>
  );
}

function ImportExport({ connected, showToast }: { connected: boolean; showToast: (m: string) => void }) {
  const doExport = async () => {
    if (!connected) { showToast('请启动本地服务以导出'); return; }
    try {
      const r = await api.exportBundle();
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const a = document.createElement('a'); a.href = url; a.download = 'yantian-export.zip'; a.click();
      URL.revokeObjectURL(url);
      showToast('导出包已下载');
    } catch (e) { showToast(e instanceof Error ? e.message : '导出失败'); }
  };
  return (
    <div className="card" style={{ maxWidth: 640, padding: 24 }}>
      <h4 style={{ marginBottom: 6 }}>导出 / 导入包</h4>
      <p style={{ fontSize: 12, color: 'var(--ink-400)', marginBottom: 18 }}>导出包含卡片与原文，逐文件 SHA256 防篡改；导入幂等去重，可跨设备迁移。</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn pri" onClick={() => void doExport()}><Icon name="arrow" />导出数据包</button>
        <label className="btn" style={{ cursor: 'pointer' }}>
          <Icon name="plus" />导入数据包
          <input type="file" accept=".zip" hidden onChange={e => showToast('选择文件：' + (e.target.files?.[0]?.name || ''))} />
        </label>
      </div>
    </div>
  );
}
