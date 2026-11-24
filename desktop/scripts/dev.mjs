import { createServer } from 'vite';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

/**
 * 开发态启动脚本：
 * 1. 编译主进程 + 打包 preload
 * 2. 启动 Vite dev server（HMR）
 * 3. 用 VITE_DEV_SERVER_URL 拉起 Electron
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = 5173;

const [major] = process.versions.node.split('.');
if (Number(major) < 20) {
  console.error(`[dev] 需要 Node.js >= 20，当前 ${process.versions.node}`);
  process.exit(1);
}

function buildElectronMain() {
  console.log('[dev] 编译主进程…');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-electron.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
}

async function main() {
  buildElectronMain();

  const server = await createServer({ server: { host: HOST, port: PORT, strictPort: true } });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://${HOST}:${PORT}/`;
  console.log(`[dev] Vite dev server: ${url}`);

  const child = spawn(electronPath, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });

  const shutdown = async (code) => {
    try {
      await server.close();
    } catch {
      // ignore
    }
    process.exit(code ?? 0);
  };

  child.on('exit', (code) => {
    void shutdown(code ?? 0);
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
    void shutdown(0);
  });
}

main().catch((error) => {
  console.error('[dev] 启动失败：', error);
  process.exit(1);
});
