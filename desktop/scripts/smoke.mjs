import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

/**
 * 冒烟测试：构建后以 PKB_SMOKE=1 启动 Electron，校验首屏挂载与 IPC 桥。
 * 退出码 0 = 通过；用于本地与后续 CI。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('[smoke] 构建产物…');
const buildStep =
  process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'npm run build']]
    : ['npm', ['run', 'build']];
execFileSync(buildStep[0], buildStep[1], { cwd: root, stdio: 'inherit' });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkb-smoke-'));
console.log(`[smoke] user-data-dir=${userDataDir}`);

const child = spawn(electronPath, ['.', `--user-data-dir=${userDataDir}`], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PKB_SMOKE: '1' },
});

const timer = setTimeout(() => {
  console.error('[smoke] 超时，强制结束');
  child.kill('SIGKILL');
}, 60_000);

child.on('exit', (code) => {
  clearTimeout(timer);
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  console.log(`[smoke] 退出码 ${code ?? 'null'}`);
  process.exit(code ?? 1);
});
