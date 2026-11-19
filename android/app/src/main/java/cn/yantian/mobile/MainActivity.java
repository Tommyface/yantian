package cn.yantian.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import cn.yantian.mobile.plugins.WebDavHttpPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册自研 WebDAV 原生 HTTP 插件（OkHttp，支持 PROPFIND/MKCOL）
        registerPlugin(WebDavHttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
