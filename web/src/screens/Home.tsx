import { Icon } from '../components/Icon';
import { useData } from '../data';

const WEEK = [
  { label: '周五', h: 34 }, { label: '周六', h: 52 }, { label: '周日', h: 28 },
  { label: '周一', h: 66 }, { label: '周二', h: 45 }, { label: '周三', h: 78 },
  { label: '今天', h: 92, today: true },
];

interface Props { onNavigate: (s: 'home' | 'library' | 'write' | 'capture' | 'review') => void }

export function HomeScreen({ onNavigate }: Props) {
  const { stats, cards, connected, syncScan, loading } = useData();
  const total = stats.cards || cards.length;
  const confirmed = stats.byStatus?.confirmed ?? cards.filter(c => c.status === 'confirmed').length;
  const candidate = stats.byStatus?.candidate ?? cards.filter(c => c.status === 'candidate').length;
  const mastered = cards.filter(c => c.mastery === 'mastered').length;
  const progress = confirmed ? Math.round(mastered / confirmed * 100) : 68;

  const recent = cards.slice(0, 4);
  const typeLabel: Record<string, string> = { golden_sentence: '金句', subheading: '小标题', practice: '改革实践', article: '好文章' };

  return (
    <div className="screen home-screen">
      <div className="page-title">今日</div>
      <div className="page-sub">厚积薄发，每一条素材都在为考场蓄力</div>

      <div className="hero">
        <div>
          <h3>下午好，继续今天的积累</h3>
          <p>距 2026 年度遴选笔试还有 128 天 · 本周已沉淀 24 条素材</p>
          <div className="hero-actions">
            <button className="hero-btn pri" onClick={() => void syncScan()}><Icon name="sync" />{loading ? '同步中…' : '同步拾页库'}</button>
            <button className="hero-btn" onClick={() => onNavigate('capture')}><Icon name="plus" />采集素材</button>
            <button className="hero-btn" onClick={() => onNavigate('write')}><Icon name="pen" />打开写作台</button>
          </div>
        </div>
        <div className="day"><b>128</b><span>DAYS TO GO</span></div>
      </div>

      <div className="stat-grid">
        <div className="stat"><div className="top"><span className="lbl">素材总量</span><span className="ico" style={{ background: 'var(--primary-50)', color: 'var(--primary-500)' }}><Icon name="book" /></span></div><div className="num">{total}</div><div className="delta">较上周 <b>+24</b></div></div>
        <div className="stat"><div className="top"><span className="lbl">已确认</span><span className="ico" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}><Icon name="check" /></span></div><div className="num">{confirmed}</div><div className="delta">逐字校验通过</div></div>
        <div className="stat"><div className="top"><span className="lbl">待整理</span><span className="ico" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}><Icon name="clock" /></span></div><div className="num">{candidate}</div><div className="delta">AI 抽取候选</div></div>
        <div className="stat"><div className="top"><span className="lbl">复习进度</span><span className="ico" style={{ background: 'var(--gold-bg)', color: 'var(--gold)' }}><Icon name="review" /></span></div><div className="num">{progress}%</div><div className="delta">已掌握 {mastered} / {confirmed}</div></div>
      </div>

      <div className="today-grid">
        <div className="card">
          <div className="card-h"><h4>近 7 日积累趋势</h4><a>查看详情 →</a></div>
          <div className="card-b">
            <div className="bars">
              {WEEK.map((d, i) => (
                <div className="bar-col" key={i}><div className={`v ${d.today ? 'today' : ''}`} style={{ height: `${d.h}%` }} /><small>{d.label}</small></div>
              ))}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h4>最近入库</h4><a onClick={() => onNavigate('library')}>查看全部 →</a></div>
          <div className="card-b" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {recent.length === 0 && <div className="empty-inline">暂无素材，点击「采集素材」开始</div>}
            {recent.map((c, i) => (
              <div className="feed-item" key={c.cardId}>
                <span className={`feed-mark ${c.type === 'golden_sentence' ? 'g' : ''}`} />
                <div className="feed-body">
                  <p>{c.content}</p>
                  <div className="feed-meta"><span>{c.origin.site || '未知来源'}</span><span>{typeLabel[c.type]}</span><span>{i === 0 ? '刚刚' : `${i} 天前`}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!connected && <div className="offline-note"><Icon name="settings" size={14} /> 当前为演示数据 · 启动本地服务 <code>pnpm start</code> 后自动切换为真实数据</div>}
    </div>
  );
}
