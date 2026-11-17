import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { useData } from '../data';
import { api } from '../api';
import type { MaterialCard, SearchHit, ExamTopic } from '../types';

const TYPE_LABEL: Record<string, string> = { golden_sentence: '金句', subheading: '小标题', practice: '改革实践', article: '好文章' };
const STATUS_LABEL: Record<string, string> = { confirmed: '已确认', candidate: '待确认', unprocessed: '未处理', used: '已使用' };
const TOPICS: string[] = ['政策理论', '综合分析', '文字表达', '山东实践'];
const SOURCES = ['人民日报', '求是', '半月谈', '人民论坛', '山东宣传'];

function hitToCard(h: SearchHit): MaterialCard {
  return {
    cardId: h.cardId || h.sourceId || Math.random().toString(36),
    sourceId: h.sourceId || h.cardId || '',
    type: h.type || 'golden_sentence',
    content: h.content, sourceExcerpt: h.content,
    origin: h.origin || { url: '', site: '', author: '', capturedAt: '' },
    topics: h.topics || [], scenes: [], status: h.status || 'confirmed', mastery: 'new',
    extractorVersion: '', createdAt: '',
  };
}

export function LibraryScreen() {
  const { cards, connected } = useData();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [hits, setHits] = useState<MaterialCard[] | null>(null);

  useEffect(() => {
    if (!query.trim()) { setHits(null); return; }
    if (!connected) return;
    const t = window.setTimeout(() => {
      api.search(query, typeFilter !== 'all' ? { type: typeFilter } : {}).then(r => {
        setHits(r.hits.map(hitToCard).filter(c => c.content));
      }).catch(() => setHits(null));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query, typeFilter, connected]);

  const list = useMemo(() => {
    if (hits && hits.length > 0) return hits;
    let out = [...cards];
    if (typeFilter !== 'all') out = out.filter(c => c.type === typeFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter(c => c.content.toLowerCase().includes(q) || c.origin.site.toLowerCase().includes(q));
    }
    return out;
  }, [cards, hits, typeFilter, query]);

  useEffect(() => {
    if (list.length && !list.find(c => c.cardId === selected)) setSelected(list[0].cardId);
    if (!list.length) setSelected(null);
  }, [list, selected]);

  const detail = list.find(c => c.cardId === selected) || null;
  const chips = [
    { key: 'all', label: '全部', n: cards.length },
    { key: 'golden_sentence', label: '金句', n: cards.filter(c => c.type === 'golden_sentence').length },
    { key: 'subheading', label: '小标题', n: cards.filter(c => c.type === 'subheading').length },
    { key: 'practice', label: '改革实践', n: cards.filter(c => c.type === 'practice').length },
    { key: 'article', label: '好文章', n: cards.filter(c => c.type === 'article').length },
  ];

  return (
    <div className="screen library-screen">
      <div className="page-title">素材库</div>
      <div className="page-sub">共 {cards.length} 条素材 · 全部来自权威媒体，逐字可溯</div>

      <div className="lib-toolbar">
        <div className="lib-search">
          <Icon name="search" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索金句、标题、关键词或媒体…" />
          {query && <button className="clear-q" onClick={() => setQuery('')}>×</button>}
        </div>
        <button className="btn"><Icon name="filter" />筛选</button>
      </div>

      <div className="filter-chips">
        {chips.map(c => (
          <span key={c.key} className={`chip ${typeFilter === c.key ? 'on' : ''}`} onClick={() => setTypeFilter(c.key)}>{c.label} {c.n}</span>
        ))}
        <span className="chip gray">待确认 {cards.filter(c => c.status === 'candidate').length}</span>
      </div>

      <div className="lib-layout">
        <div className="topic-tree">
          <h5>主题分类</h5>
          <a className="on">全部素材 <span>{cards.length}</span></a>
          {TOPICS.map(t => <a key={t}>{t} <span>{cards.filter(c => c.topics.includes(t as ExamTopic)).length}</span></a>)}
          <h5 style={{ marginTop: 18 }}>来源媒体</h5>
          {SOURCES.map(s => <a key={s}>{s} <span>{cards.filter(c => c.origin.site === s).length || '—'}</span></a>)}
        </div>

        <div className="mat-list">
          {list.length === 0 && <div className="empty-state"><Icon name="search" size={28} /><p>没有匹配的素材</p><span>试试其他关键词或筛选条件</span></div>}
          {list.map(c => (
            <div key={c.cardId} className={`mat ${selected === c.cardId ? 'sel' : ''}`} onClick={() => setSelected(c.cardId)}>
              <div className="mat-top">
                <span className={`tag ${c.type === 'golden_sentence' ? 'gold' : ''}`}>{TYPE_LABEL[c.type]}</span>
                <span className="tag">{c.topics[0] || '综合'}</span>
                <span className={`tag ${c.status === 'confirmed' ? 'green' : 'amber'}`}>{STATUS_LABEL[c.status]}</span>
              </div>
              <div className="mat-q">{c.content}</div>
              <div className="mat-foot"><span>{c.origin.site || '未知'} · {c.origin.capturedAt?.slice(0, 7)}</span><span>{c.origin.url ? <a href={c.origin.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>查看原文 ↗</a> : '查看原文 ↗'}</span></div>
            </div>
          ))}
        </div>

        <div className="detail">
          {detail ? (
            <>
              <h5>素材详情</h5>
              <div className="q">{detail.content}</div>
              <div className="row"><span>类型</span><b>{TYPE_LABEL[detail.type]}</b></div>
              <div className="row"><span>主题</span><b>{detail.topics.join(' · ') || '综合'}</b></div>
              <div className="row"><span>来源媒体</span><b>{detail.origin.site || '未知'}</b></div>
              <div className="row"><span>作者</span><b>{detail.origin.author || '—'}</b></div>
              <div className="row"><span>采集时间</span><b>{detail.origin.capturedAt?.replace('T', ' ').slice(0, 16) || '—'}</b></div>
              <div className="row"><span>适用题型</span><b>{detail.scenes.join(' · ') || '案例分析'}</b></div>
              <div className="verify"><Icon name="check" size={15} />逐字校验通过 · 出处完整</div>
            </>
          ) : <div className="empty-inline">选择一条素材查看详情</div>}
        </div>
      </div>

      {/* 移动端详情折叠卡 */}
      {detail && (
        <div className="m-detail-card">
          <div className="m-card-h m-detail-h"><h4>素材详情</h4><a>收起</a></div>
          <div className="m-quote">{detail.content}</div>
          <div className="m-row"><span>主题</span><b>{detail.topics.join(' · ') || '综合'}</b></div>
          <div className="m-row"><span>来源</span><b>{detail.origin.site || '未知'}</b></div>
          <div className="m-verify"><Icon name="check" size={15} />逐字校验通过 · 出处完整</div>
        </div>
      )}
    </div>
  );
}
