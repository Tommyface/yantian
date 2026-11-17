import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { useData } from '../data';
import { api } from '../api';
import type { MaterialCard, TopicBundle, ExamTopic } from '../types';

const TYPE_GROUPS: Array<{ key: keyof Pick<TopicBundle, 'golden_sentence' | 'subheading' | 'practice' | 'article'>; label: string }> = [
  { key: 'golden_sentence', label: '金句' },
  { key: 'subheading', label: '写作小标题' },
  { key: 'practice', label: '改革实践' },
  { key: 'article', label: '好文章' },
];
const TOPICS: ExamTopic[] = ['政策理论', '综合分析', '文字表达', '山东实践'];

export function WriteScreen() {
  const { bundle, connected, showToast } = useData();
  const [topic, setTopic] = useState<ExamTopic | '全部'>('政策理论');
  const [activeBundle, setActiveBundle] = useState<TopicBundle>(bundle);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('以钉钉子精神推动基层治理现代化');

  useEffect(() => {
    if (!connected || topic === '全部') { setActiveBundle(bundle); return; }
    api.bundle(topic).then(b => { if (b.total > 0) setActiveBundle(b); else setActiveBundle(bundle); }).catch(() => setActiveBundle(bundle));
  }, [topic, bundle, connected]);

  const allCards = useMemo(() => TYPE_GROUPS.flatMap(g => activeBundle[g.key] || []), [activeBundle]);

  useEffect(() => {
    const defaults = new Set(allCards.slice(0, 3).map(c => c.cardId));
    setPicked(defaults);
  }, [activeBundle]);

  const toggle = (id: string) => setPicked(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const selectedCards = allCards.filter(c => picked.has(c.cardId));

  const copyCitations = async () => {
    const cited = selectedCards.map(c => {
      const src = [c.origin.site, c.origin.author].filter(Boolean).join(' · ') || '出处见原文';
      return `“${c.content}”\n—— ${src}${c.origin.url ? `（${c.origin.url}）` : ''}`;
    }).join('\n\n');
    if (!cited) { showToast('请先选择素材'); return; }
    try {
      await navigator.clipboard.writeText(cited);
      showToast(`已复制 ${selectedCards.length} 条引用（含出处）`);
    } catch {
      showToast('复制失败，请手动选择');
    }
  };

  return (
    <div className="screen write-screen">
      <div className="page-title">写作台</div>
      <div className="page-sub">选主题 → 调素材 → 写材料，出处随文带走</div>

      <div className="topic-tabs">
        <span className={topic === '全部' ? 'on' : ''} onClick={() => setTopic('全部')}>全部</span>
        {TOPICS.map(t => <span key={t} className={topic === t ? 'on' : ''} onClick={() => setTopic(t)}>{t}</span>)}
      </div>

      <div className="write-layout">
        <div className="pack">
          {TYPE_GROUPS.map(g => {
            const items = activeBundle[g.key] || [];
            if (items.length === 0) return null;
            return (
              <div key={g.key}>
                <h5>{g.label} · {items.length}</h5>
                {items.map(c => (
                  <div key={c.cardId} className={`pick ${picked.has(c.cardId) ? 'on' : ''}`} onClick={() => toggle(c.cardId)}>
                    <span className="cbox">{picked.has(c.cardId) && <Icon name="check" size={12} />}</span>
                    <p>{c.content}</p>
                  </div>
                ))}
              </div>
            );
          })}
          {allCards.length === 0 && <div className="empty-inline">该主题暂无素材，去采集页添加</div>}
        </div>

        <div className="editor">
          <div className="editor-h"><input value={draft} onChange={e => setDraft(e.target.value)} /><span className="tag gold">草稿</span></div>
          <div className="editor-tools"><span className="on">正文</span><span>标题</span><span>小标题</span><span>引用</span><span style={{ marginLeft: 'auto' }}>自动保存 ✓</span></div>
          <div className="editor-body" contentEditable suppressContentEditableWarning>
            {selectedCards.length > 0 ? (
              <>　　<span className="ins">{selectedCards[0].content}</span>基层治理是国家治理的基石，事关群众切身利益与社会和谐稳定。<br /><br />
              　　{selectedCards[1] && <><span className="ins">{selectedCards[1].content}</span>，要求我们在工作中既要宏观着眼，更要微观着手。</>}<span className="cursor" /><br /><br />
              　　<span className="ph">继续写作，选中左侧素材可快速插入到此处…</span></>
            ) : (
              <>　　<span className="ph">从左侧素材包勾选素材，即可插入到此处开始写作…</span><span className="cursor" /></>
            )}
          </div>
        </div>

        <div className="selected">
          <h5>已选素材</h5>
          <div className="n">{selectedCards.length} 条 · 复制时自动附带出处</div>
          {selectedCards.map(c => (
            <div className="sel-item" key={c.cardId}><p>{c.content}</p><div className="src">{c.origin.site || '未知'} · {c.origin.capturedAt?.slice(0, 7)}</div></div>
          ))}
          {selectedCards.length === 0 && <div className="empty-inline">尚未选择素材</div>}
          <button className="copy-btn" onClick={() => void copyCitations()}><Icon name="copy" />复制全部引用</button>
        </div>
      </div>
    </div>
  );
}
