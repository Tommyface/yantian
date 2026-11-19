package cn.yantian.mobile.plugins;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * WebDAV 原生 HTTP 插件。
 *
 * 背景：Android WebView 的 fetch 受 CORS 限制，内置 CapacitorHttp 走 HttpURLConnection，
 * 方法白名单不含 PROPFIND / MKCOL（WebDAV 必需），都会失败。
 * 本插件用 OkHttp 支持任意 HTTP 方法，与拾页 App 同源，供 webdav.ts 调用。
 *
 * JS 调用：
 *   WebDavHttp.request({ url, method, headers: {}, body?: string })
 *   返回 { status: number, headers: Record<string,string>, body: string, ok: boolean }
 */
@CapacitorPlugin(name = "WebDavHttp")
public class WebDavHttpPlugin extends Plugin {

    private static final String TAG = "WebDavHttp";

    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build();

    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final JSObject headersObj = call.getObject("headers");
        final String body = call.getString("body", null);

        if (url == null || url.isEmpty()) {
            call.reject("url 不能为空");
            return;
        }

        // 网络请求放后台线程，避免阻塞 WebView 主线程。
        new Thread(() -> {
            try {
                Request.Builder builder = new Request.Builder().url(url);

                // 设置请求头
                if (headersObj != null) {
                    Iterator<String> it = headersObj.keys();
                    while (it.hasNext()) {
                        String key = it.next();
                        Object val = headersObj.opt(key);
                        if (val != null) {
                            builder = builder.header(key, String.valueOf(val));
                        }
                    }
                }

                // OkHttp 4.x 的 MediaType 不能为 null，统一用 text/plain 占位。
                MediaType mt = MediaType.parse("text/plain; charset=utf-8");
                RequestBody reqBody = RequestBody.create(
                        body != null ? body : "", mt);
                String m = method.toUpperCase();
                if (m.equals("GET") || m.equals("HEAD")) {
                    builder = builder.get();
                } else {
                    // PROPFIND / MKCOL / PUT 等自定义方法：OkHttp 原样发送。
                    builder = builder.method(m, reqBody);
                }

                Request req = builder.build();
                try (Response resp = client.newCall(req).execute()) {
                    int status = resp.code();
                    String respBody = resp.body() != null ? resp.body().string() : "";

                    JSObject headers = new JSObject();
                    Headers hs = resp.headers();
                    for (String name : hs.names()) {
                        try {
                            headers.put(name, hs.get(name));
                        } catch (Exception ignore) { }
                    }

                    JSObject result = new JSObject();
                    result.put("status", status);
                    result.put("ok", status >= 200 && status < 300);
                    result.put("body", respBody);
                    result.put("headers", headers);

                    getBridge().getActivity().runOnUiThread(() -> call.resolve(result));
                }
            } catch (IOException e) {
                Log.e(TAG, "request failed", e);
                String msg = e.getMessage() != null ? e.getMessage() : "网络请求失败";
                getBridge().getActivity().runOnUiThread(() -> call.reject(msg));
            } catch (Exception e) {
                Log.e(TAG, "request error", e);
                String msg = e.getMessage() != null ? e.getMessage() : "请求异常";
                getBridge().getActivity().runOnUiThread(() -> call.reject(msg));
            }
        }, "webdav-http").start();
    }
}
