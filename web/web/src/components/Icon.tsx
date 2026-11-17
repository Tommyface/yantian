// 统一图标组件：设计稿中的线性图标（stroke 风格）
import type { ReactNode } from 'react';

type IconName =
  | 'home' | 'library' | 'write' | 'capture' | 'review' | 'settings'
  | 'search' | 'bell' | 'sync' | 'plus' | 'check' | 'clock'
  | 'book' | 'pen' | 'chart' | 'copy' | 'sparkle' | 'filter'
  | 'chevron' | 'arrow' | 'external' | 'refresh' | 'layers' | 'target';

const PATHS: Record<IconName, ReactNode> = {
  home: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  library: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
  write: <><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></>,
  capture: <><path d="M12 5v14M5 12h14"/></>,
  review: <><path d="M2 12h4l3-9 5 18 3-9h5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  search: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></>,
  bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></>,
  sync: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  check: <><path d="M20 6L9 17l-5-5"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
  pen: <><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></>,
  chart: <><path d="M3 3v18h18M7 16l4-4 3 3 5-6"/></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  sparkle: <><path d="M12 2l2.4 7.4L22 12l-7.6 2.6L12 22l-2.4-7.4L2 12l7.6-2.6L12 2z"/></>,
  filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
  chevron: <><path d="M9 18l6-6-6-6"/></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  external: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>,
  layers: <><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></>,
  target: <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
};

export function Icon({ name, className = 'ic', size }: { name: IconName; className?: string; size?: number }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export const NAV_ITEMS: Array<{ key: string; label: string; icon: IconName }> = [
  { key: 'home', label: '今日', icon: 'home' },
  { key: 'library', label: '素材库', icon: 'library' },
  { key: 'write', label: '写作台', icon: 'write' },
  { key: 'capture', label: '采集', icon: 'capture' },
  { key: 'review', label: '复习', icon: 'review' },
];
