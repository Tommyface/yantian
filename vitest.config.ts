import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        // 让 node:sqlite 等 node: 前缀内置模块直接交给 Node 处理（vitest 2.x 的已知解析问题）
        external: [/^node:/],
      },
    },
  },
});