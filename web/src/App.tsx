import { useState } from 'react';
import { Icon, NAV_ITEMS } from './components/Icon';
import { useData } from './data';
import { HomeScreen } from './screens/Home';
import { LibraryScreen } from './screens/Library';
import { WriteScreen } from './screens/Write';
import { CaptureScreen } from './screens/Capture';
import { ReviewScreen } from './screens/Review';

type ScreenKey = 'home' | 'library' | 'write' | 'capture' | 'review';

const TITLES: Record<ScreenKey, string> = {
  home: '今日', library: '素材库', write: '写作台', capture: '采集', review: '复习',
};

export function App() {
  const [screen, setScreen] = useState<ScreenKey>('home');
  const { toast, connected, syncScan } = useData();

  return (
    <div className="app-shell">
      {/* ===== 桌面侧边栏 ===== */}
      <aside className="side">
        <div className="logo">
          <div className="logo-mark">砚</div>
          <div className="logo-txt"><b>砚田</b><small>YANTIAN</small></div>
        </div>
        <nav className="nav">
          {NAV_ITEMS.map(item => (
            <a
              key={item.key}
              className={screen === item.key ? 'active' : ''}
              onClick={() => setScreen(item.key as ScreenKey)}
            >
              <Icon name={item.icon} />{item.label}
            </a>
          ))}
          <div className="sep" />
          <a><Icon name="settings" />设置</a>
        </nav>
        <div className="side-foot">
          <div className="sync-status"><span className="pulse" />拾页库已同步</div>
          <div className="mini">本地存储 · 数据不出电脑</div>
        </div>
      </aside>

      {/* ===== 主区 ===== */}
      <div className="main">
        <div className="topbar">
          <div className="crumb">工作台 / <b>{TITLES[screen]}</b></div>
          <div className="top-search" onClick={() => setScreen('library')}>
            <Icon name="search" /><span>搜索素材…</span>
          </div>
          <button className="icon-btn" onClick={() => void syncScan()} title="同步拾页库">
            <Icon name="bell" />
            {!connected && <i className="badge-dot" />}
          </button>
          <div className="avatar">李</div>
        </div>
        <div className="content">
          {screen === 'home' && <HomeScreen onNavigate={setScreen} />}
          {screen === 'library' && <LibraryScreen />}
          {screen === 'write' && <WriteScreen />}
          {screen === 'capture' && <CaptureScreen />}
          {screen === 'review' && <ReviewScreen />}
        </div>
      </div>

      {/* ===== 移动端顶部栏 ===== */}
      <div className="m-appbar-top">
        <h2>砚田</h2><span className="m-sub">{TITLES[screen]}</span>
        <div className="m-right">
          <div className="m-ibtn" onClick={() => setScreen('library')}><Icon name="search" /></div>
          <div className="m-av">李</div>
        </div>
      </div>

      {/* ===== 移动端底部标签栏 ===== */}
      <nav className="m-tabs">
        {NAV_ITEMS.map(item => (
          <div key={item.key} className={`m-tab ${screen === item.key ? 'on' : ''}`} onClick={() => setScreen(item.key as ScreenKey)}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </div>
        ))}
      </nav>

      {/* ===== Toast ===== */}
      {toast && <div className="toast"><Icon name="check" size={16} />{toast}</div>}
    </div>
  );
}
