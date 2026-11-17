/**
 * CLI 启动入口：node src/p2/main.ts [vaultRoot] [port]
 * 默认 vault = ./vault，端口 = 8765，只监听 127.0.0.1。
 */

import { resolve } from 'node:path';
import { AppState } from './app-state.js';
import { startServer } from './server.js';

async function main() {
  const vaultRoot = resolve(process.argv[2] ?? 'vault');
  const port = Number(process.argv[3] ?? 8765);
  const app = await AppState.open(vaultRoot);
  // 启动时静默同步一次拾页库（新增/变更原文进索引）
  const report = await app.syncFromVault();
  const server = await startServer({ app, port });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  console.log(`砚田服务已启动: http://127.0.0.1:${actualPort}`);
  console.log(`vault: ${vaultRoot}`);
  console.log(`启动扫描: 新增 ${report.added} / 更新 ${report.updated} / 删除 ${report.removed} / 错误 ${report.errors.length}`);

  const shutdown = () => {
    server.close(() => { app.close(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error('启动失败:', e); process.exit(1); });
