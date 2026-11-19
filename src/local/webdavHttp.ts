// WebDavHttp 原生插件桥接层
// Android 的 WebView fetch 受 CORS 限制、内置 CapacitorHttp 走 HttpURLConnection 不支持
// PROPFIND/MKCOL，因此用自研 OkHttp 原生插件承载全部 WebDAV 请求。
import { registerPlugin } from '@capacitor/core';

export interface WebDavHttpResponse {
  status: number;
  ok: boolean;
  body: string;
  headers: Record<string, string>;
}

export interface WebDavHttpPlugin {
  request(options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<WebDavHttpResponse>;
}

const WebDavHttp = registerPlugin<WebDavHttpPlugin>('WebDavHttp');

export async function nativeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  data?: string,
): Promise<WebDavHttpResponse> {
  return WebDavHttp.request({ url, method, headers, body: data });
}
