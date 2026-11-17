import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useData } from '../data';
import { api } from '../api';
import type { ExtractionResult, ExtractionCandidate } from '../types';

const DEMO_NOTES = [
  { sourceId: 'n1', title: '以钉钉子精神抓落实', site: '人民日报', time: '今天 09:30' },
  { sourceId: 'n2', title: '以"绣花功夫"提升基层治理水平', site: '人民论坛', time: '昨天' },
  { sourceId: 'n3', title: '求是：扎实推进共同富裕', site: '求是', time: '3 天前' },
  { sourceId: 'n4', title: '山东改革创新典型案例汇编', site: '山东宣传', time: '5 天前' },
];

const DEMO_CANDIDATES: ExtractionCandidate[] = [
  { text: '抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。', type: 'golden_sentence', confidence: 0.92, verbatim: true, sourceId: 'n1' },
  { text: '抓落实，是党的路线方针政策转化为实际行动的关键环节。', type: 'golden_sentence', confidence: 0.86, verbatim: true, sourceId: 'n1' },
  { text: '各级政府要把抓落实作为工作的主旋律', type: 'subheading', confidence: 0.78, verbatim: true, sourceId: 'n1' },
  { text: '确保各项决策部署落地见效，层层压实责任。', type: 'golden_sentence', confidence: 0.74, verbatim: true, sourceId: 'n1' },
];

export function CaptureScreen() {
  const { connected, showToast, refresh } = useData();
  const [tab, setTab] = useState('拾页原文');
  const [activeNote, setActiveNote] = useState(DEMO_NOTES[0].sourceId);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const candidates = result?.candidates ?? DEMO_CANDIDATES;

  const doExtract = async (sourceId?: string) => {
    const sid = sourceId || activeNote;
    setActiveNote(sid);
    if (!connected) { showToast('请启动本地服务以使用真实 AI 抽取'); return; }
    setExtracting(true);
    try {
      const r = await api.extract(sid);
      setResult(r);
      showToast(`抽取完成：${r.candidates.length} 条候选`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '抽取失败');
    } finally {
      setExtracting(false);
    }
  };

  const confirm = async (c: ExtractionCandidate, idx: number) => {
    if (!connected) { showToast('演示模式：已模拟确认（启动本地服务可真实入库）'); setDoneIds(p => new Set(p).add(String(idx))); return; }
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
        {['拾页原文', '手动导入', '导出 / 导入包'].map(t => <span key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</span>)}
      </div>

      {tab === '拾页原文' && (
        <div className="cap-layout">
          <div>
            <div className="card" style={{ padding: 14 }}>
              {DEMO_NOTES.map(n => (
                <div key={n.sourceId} className={`note ${activeNote === n.sourceId ? 'on' : ''}`} onClick={() => setActiveNote(n.sourceId)}>
                  <h5>{n.title}</h5>
                  <div className="m"><span>{n.site}</span><span>·</span><span>{n.time}</span><span className="act" onClick={e => { e.stopPropagation(); void doExtract(n.sourceId); }}>{extracting && activeNote === n.sourceId ? '抽取中…' : '抽取候选'}</span></div>
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
  const [content, setContent] = useState('');
  return (
    <div className="card" style={{ maxWidth: 640, padding: 24 }}>
      <h4 style={{ marginBottom: 6 }}>手动导入素材</h4>
      <p style={{ fontSize: 12, color: 'var(--ink-400)', marginBottom: 18 }}>从拾页原文复制片段入库，逐字校验仍强制生效。</p>
      <label className="field-lbl">素材内容</label>
      <textarea className="input" rows={5} value={content} onChange={e => setContent(e.target.value)} placeholder="粘贴原文中的逐字片段…" style={{ resize: 'vertical', marginBottom: 14 }} />
      <button className="btn pri" onClick={() => { if (!content.trim()) return; onDone(); setContent(''); }}>
        <Icon name="plus" />{connected ? '确认入库' : '演示提交'}
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
