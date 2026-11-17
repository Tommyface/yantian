// 设置抽屉：坚果云 WebDAV 配置 + 数据管理
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { api } from '../api';
import type { WebDavConfig } from '../local/webdav';

interface Props {
  open: boolean;
  onClose: () => void;
  showToast: (m: string) => void;
  onChanged?: () => void;
}

export function SettingsSheet({ open, onClose, showToast, onChanged }: Props) {
  const [cfg, setCfg] = useState<WebDavConfig>({ baseUrl: '', username: '', appPassword: '', autoUpload: false });
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (open) void api.webdav.getConfig().then(setCfg);
  }, [open]);

  if (!open) return null;

  const save = async () => {
    await api.webdav.setConfig(cfg);
    showToast('设置已保存到本机');
    onClose();
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.webdav.test(cfg);
      showToast(r.message);
    } finally { setTesting(false); }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const n = await api.webdav.uploadAll();
      showToast(`已上传 ${n} 篇笔记到坚果云`);
      onChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '同步失败');
    } finally { setSyncing(false); }
  };

  const set = (k: keyof WebDavConfig, v: string | boolean) => setCfg((p: WebDavConfig) => ({ ...p, [k]: v }));

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>设置 · 坚果云同步</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className="sheet-body">
          <p className="sheet-tip">素材以 md 存于本机，可增量同步到坚果云。密码使用「应用专用密码」，不会上传或写死在程序里。</p>
          <label className="field-lbl">WebDAV 地址</label>
          <input className="input" value={cfg.baseUrl} onChange={e => set('baseUrl', e.target.value)} placeholder="https://dav.jianguoyun.com/dav/yantian" />
          <label className="field-lbl">账号（邮箱）</label>
          <input className="input" value={cfg.username} onChange={e => set('username', e.target.value)} placeholder="you@example.com" />
          <label className="field-lbl">应用专用密码</label>
          <input className="input" type="password" value={cfg.appPassword} onChange={e => set('appPassword', e.target.value)} placeholder="坚果云应用专用密码" />
          <label className="switch-row">
            <input type="checkbox" checked={cfg.autoUpload} onChange={e => set('autoUpload', e.target.checked)} />
            <span>采集后自动上传</span>
          </label>
          <div className="sheet-actions">
            <button className="btn" onClick={() => void test()} disabled={testing}>{testing ? '测试中…' : '测试连接'}</button>
            <button className="btn" onClick={() => void syncNow()} disabled={syncing}>{syncing ? '上传中…' : '立即上传全部'}</button>
          </div>
          <p className="sheet-note">提示：卡片与索引只在本地生成，不同步，避免多端冲突。坚果云仅作 md 中转。</p>
        </div>
        <div className="sheet-foot">
          <button className="btn pri" onClick={() => void save()}>保存设置</button>
        </div>
      </div>
    </div>
  );
}
