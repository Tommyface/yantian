import { useState } from 'react';
import { Icon } from '../components/Icon';
import { useData } from '../data';

export function ReviewScreen() {
  const { review, setMasteryLocal, showToast } = useData();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const total = review.length;
  const card = review[index];

  const next = () => { setFlipped(false); setIndex(i => (i + 1) % Math.max(total, 1)); };
  const prev = () => { setFlipped(false); setIndex(i => (i - 1 + Math.max(total, 1)) % Math.max(total, 1)); };
  const mark = (m: 'reviewing' | 'mastered') => {
    if (!card) return;
    setMasteryLocal(card.cardId, m);
    showToast(m === 'mastered' ? '已标记掌握 ✓' : '已标记巩固中');
    next();
  };

  const pct = total ? Math.round(((index + 1) / total) * 100) : 0;

  if (!card) {
    return (
      <div className="screen review-screen">
        <div className="page-title">复习</div>
        <div className="page-sub">把素材真正记进脑子里</div>
        <div className="empty-state" style={{ height: 400 }}><Icon name="review" size={36} /><p>暂无复习卡片</p><span>确认素材后会自动进入复习卡组</span></div>
      </div>
    );
  }

  return (
    <div className="screen review-screen">
      <div className="page-title">复习</div>
      <div className="page-sub">今日待巩固 {total} 张 · 优先复习掌握度低的素材</div>

      <div className="review-wrap">
        <div className="rv-progress"><span>第 {index + 1} 张 / 共 {total} 张</span><div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div><span>{pct}%</span></div>

        <div className={`flash ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(f => !f)}>
          {!flipped ? (
            <>
              <div className="face-tag">正面 · {card.front}</div>
              <div className="front-q">请回忆：{card.back.slice(0, 40)}{card.back.length > 40 ? '…' : ''} 的经典表述</div>
              <div className="hint">点击卡片翻面查看答案</div>
            </>
          ) : (
            <>
              <div className="face-tag">背面 · 出处 {card.originText}</div>
              <div className="front-q answer">{card.back}</div>
              <div className="hint">—— {card.originText || '出处见原文'}</div>
            </>
          )}
        </div>

        <div className="rv-actions">
          <button className="rv-btn" onClick={prev}><Icon name="arrow" size={14} />上一张</button>
          <button className="rv-btn good" onClick={() => mark('reviewing')}><Icon name="clock" size={14} />巩固中</button>
          <button className="rv-btn best" onClick={() => mark('mastered')}><Icon name="check" size={14} />已掌握</button>
          <button className="rv-btn" onClick={next}>下一张 →</button>
        </div>

        <div className="rv-dots">
          {review.map((_, i) => <i key={i} className={i === index ? 'cur' : i < index ? 'done' : ''} />)}
        </div>
      </div>
    </div>
  );
}
