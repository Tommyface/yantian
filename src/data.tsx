// 全局数据状态：加载 API 数据 + 演示兜底
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { AppStats, MaterialCard, TopicBundle, ReviewCard, TopicSummary } from './types';

// ============ 演示数据（后端数据稀疏时兜底，保证界面完整）============
const DEMO_STATS: AppStats = {
  notes: 286, cards: 286, notesFts: 286, cardsFts: 286,
  byStatus: { unprocessed: 12, candidate: 12, confirmed: 198, used: 76 },
  byType: { golden_sentence: 124, subheading: 68, practice: 54, article: 40 },
  byTopic: { '政策理论': 96, '综合分析': 72, '文字表达': 65, '山东实践': 53 },
};

const mkCard = (
  id: string, type: MaterialCard['type'], content: string, site: string,
  topics: MaterialCard['topics'], status: MaterialCard['status'], mastery: MaterialCard['mastery'],
  daysAgo: number
): MaterialCard => ({
  cardId: id, sourceId: `demo-${id}`, type, content,
  sourceExcerpt: content,
  origin: { url: '', site, author: '本报评论员', capturedAt: new Date(Date.now() - daysAgo * 86400000).toISOString() },
  topics, scenes: ['案例分析'], status, mastery,
  extractorVersion: 'demo', createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
});

export const DEMO_CARDS: MaterialCard[] = [
  mkCard('d1', 'golden_sentence', '基层强则国家强，基层安则天下安。', '求是', ['政策理论', '综合分析'], 'confirmed', 'mastered', 3),
  mkCard('d2', 'subheading', '以"绣花功夫"提升基层治理精细化水平', '人民日报', ['综合分析'], 'confirmed', 'reviewing', 5),
  mkCard('d3', 'golden_sentence', '抓落实，贵在持之以恒，要有钉钉子精神，一锤接着一锤敲。', '人民日报', ['文字表达'], 'candidate', 'new', 0),
  mkCard('d4', 'practice', '山东持续深化放管服改革，优化营商环境，激发市场主体活力。', '山东宣传', ['山东实践'], 'confirmed', 'reviewing', 7),
  mkCard('d5', 'golden_sentence', '为政之道，贵在实干；干事之要，重在担当。', '求是', ['政策理论'], 'confirmed', 'new', 9),
  mkCard('d6', 'subheading', '下足"苦功夫"，写好"民生卷"', '人民论坛', ['文字表达'], 'confirmed', 'mastered', 12),
  mkCard('d7', 'practice', '菏泽发展汉服产业，赋能乡村振兴', '山东宣传', ['山东实践'], 'confirmed', 'new', 14),
  mkCard('d8', 'article', '扎实推进共同富裕，让发展成果更多更公平惠及全体人民', '求是', ['政策理论'], 'confirmed', 'reviewing', 16),
  mkCard('d9', 'golden_sentence', '各级政府要把抓落实作为工作的主旋律', '人民日报', ['综合分析'], 'confirmed', 'new', 18),
  mkCard('d10', 'subheading', '以钉钉子精神推动各项决策部署落地见效', '半月谈', ['文字表达'], 'confirmed', 'mastered', 20),
];

const DEMO_REVIEW: ReviewCard[] = DEMO_CARDS.filter(c => c.status === 'confirmed').map(c => ({
  cardId: c.cardId,
  front: `${c.topics.join(' / ')} · ${({ golden_sentence: '金句', subheading: '小标题', practice: '改革实践', article: '好文章' } as Record<string, string>)[c.type]}`,
  back: c.content,
  originText: c.origin.site,
  sourceId: c.sourceId,
  mastery: c.mastery,
  type: c.type,
}));

function buildDemoBundle(cards: MaterialCard[]): TopicBundle {
  const by = (t: MaterialCard['type']) => cards.filter(c => c.type === t);
  return {
    topic: '全部', total: cards.length,
    golden_sentence: by('golden_sentence'), subheading: by('subheading'),
    practice: by('practice'), article: by('article'),
  };
}

interface DataCtx {
  connected: boolean;
  loading: boolean;
  stats: AppStats;
  cards: MaterialCard[];
  topics: TopicSummary[];
  bundle: TopicBundle;
  review: ReviewCard[];
  notes: Array<{ sourceId: string; title: string; site: string; capturedAt: string }>;
  toast: string | null;
  showToast: (msg: string) => void;
  refresh: () => Promise<void>;
  syncScan: () => Promise<void>;
  setMasteryLocal: (cardId: string, mastery: MaterialCard['mastery']) => void;
}

const Ctx = createContext<DataCtx | null>(null);

export function useData(): DataCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData must be used within DataProvider');
  return v;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AppStats>(DEMO_STATS);
  const [cards, setCards] = useState<MaterialCard[]>(DEMO_CARDS);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [bundle, setBundle] = useState<TopicBundle>(() => buildDemoBundle(DEMO_CARDS));
  const [review, setReview] = useState<ReviewCard[]>(DEMO_REVIEW);
  const [notes, setNotes] = useState<DataCtx['notes']>([]);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  };

  const refresh = async () => {
    try {
      await api.health();
      setConnected(true);
      const [s, c, t, b, r] = await Promise.all([
        api.stats(), api.cards(), api.topics(), api.bundle(), api.review(),
      ]);
      // 只有后端有真实数据才覆盖演示数据
      if (c.length > 0) {
        setCards(c);
        setBundle(b.total > 0 ? b : buildDemoBundle(c));
        setReview(r.length > 0 ? r : DEMO_REVIEW);
        setStats(s.cards > 0 ? s : { ...s, cards: c.length, notes: c.length });
      } else {
        setBundle(buildDemoBundle(DEMO_CARDS));
        setReview(DEMO_REVIEW);
      }
      setTopics(t);
      setStats(prev => ({ ...prev, ...s, cards: s.cards || prev.cards, notes: s.notes || prev.notes }));
    } catch {
      setConnected(false);
      // 离线：保留演示数据
    } finally {
      setLoading(false);
    }
  };

  const syncScan = async () => {
    try {
      const rep = await api.scan();
      // 增量同步：重点展示「变化了多少、跳过了多少未变项」，让防限流效果可见。
      const changed = rep.changed ?? ((rep.added ?? 0) + (rep.updated ?? 0) + (rep.removed ?? 0));
      const parts = [`变化 ${changed}`];
      if (rep.added) parts.push(`新增 ${rep.added}`);
      if (rep.updated) parts.push(`更新 ${rep.updated}`);
      if (rep.removed) parts.push(`移除 ${rep.removed}`);
      if (rep.skipped) parts.push(`跳过 ${rep.skipped}`);
      showToast(`已从${rep.from ?? '坚果云'}同步：${parts.join(' / ')}`);
      await refresh();
    } catch (e) {
      // 隐患修复：未配置 / 网络失败都会走到这里，显示真实原因而非"同步完成"。
      showToast(e instanceof Error ? e.message : '同步失败');
    }
  };

  const setMasteryLocal = (cardId: string, mastery: MaterialCard['mastery']) => {
    setCards(prev => prev.map(c => c.cardId === cardId ? { ...c, mastery } : c));
    setReview(prev => prev.map(c => c.cardId === cardId ? { ...c, mastery } : c));
    if (connected) api.setMastery(cardId, mastery).catch(() => {});
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <Ctx.Provider value={{ connected, loading, stats, cards, topics, bundle, review, notes, toast, showToast, refresh, syncScan, setMasteryLocal }}>
      {children}
    </Ctx.Provider>
  );
}
