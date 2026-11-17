// REST API 封装：对接 yantian 本地服务（127.0.0.1:8765）
// 开发环境通过 Vite proxy 转发，生产环境可配置 VITE_API_BASE

const API_BASE = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      msg = data.error || data.message || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ ok: boolean; name: string; version: string }>('/api/health'),
  stats: () => request<import('./types').AppStats>('/api/stats'),
  scan: () => request<{ added: number; updated: number; removed: number; [k: string]: unknown }>('/api/scan', { method: 'POST' }),
  search: (q: string, filters: Record<string, string> = {}) => {
    const p = new URLSearchParams({ q, ...filters });
    return request<import('./types').SearchResult>(`/api/search?${p}`);
  },
  notes: (sourceId: string) => request<import('./types').SharedNote>(`/api/notes/${encodeURIComponent(sourceId)}`),
  topics: () => request<import('./types').TopicSummary[]>('/api/topics'),
  bundle: (topic?: string) => request<import('./types').TopicBundle>(`/api/bundle${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`),
  review: () => request<import('./types').ReviewCard[]>('/api/review'),
  cards: () => request<import('./types').MaterialCard[]>('/api/cards'),
  manualCard: (body: { sourceId: string; content: string; type: string; topics?: string[]; scenes?: string[] }) =>
    request<import('./types').MaterialCard>('/api/cards/manual', { method: 'POST', body: JSON.stringify(body) }),
  confirmCard: (body: { sourceId: string; content: string; type: string; topics?: string[]; scenes?: string[] }) =>
    request<import('./types').MaterialCard>('/api/cards/confirm', { method: 'POST', body: JSON.stringify(body) }),
  extract: (sourceId: string) =>
    request<import('./types').ExtractionResult>('/api/extract', { method: 'POST', body: JSON.stringify({ sourceId }) }),
  setStatus: (id: string, status: string) =>
    request<import('./types').MaterialCard>(`/api/cards/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setMastery: (id: string, mastery: string) =>
    request<import('./types').MaterialCard>(`/api/cards/${encodeURIComponent(id)}/mastery`, { method: 'PATCH', body: JSON.stringify({ mastery }) }),
  exportBundle: () => request<{ base64: string; bytes: number }>('/api/export', { method: 'POST' }),
  importBundle: (base64: string) =>
    request<{ ok: boolean; errors: string[]; imported: number }>('/api/import', { method: 'POST', body: JSON.stringify({ base64 }) }),
};
