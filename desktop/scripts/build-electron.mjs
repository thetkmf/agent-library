import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * 主进程构建：tsc 编译（保留 CommonJS 输出），esbuild 单独打包 preload。
 * preload 必须打包：sandbox 渲染进程下的 preload 只能 require('electron')，
 * 不能直接 require 相对路径的共享模块。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.electron.json'], { cwd: root, stdio: 'inherit' });

await build({
  entryPoints: [path.join(root, 'electron', 'preload.ts')],
  outfile: path.join(root, 'dist-electron', 'electron', 'preload.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
