import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 相对路径：Capacitor WebView 用 file:// 或 http://localhost 加载都能正确取到资源
  base: './',
  build: {
    target: 'es2020',
  },
});
