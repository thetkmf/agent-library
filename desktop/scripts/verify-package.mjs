import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

/**
 * 打包产物验收脚本（F12/I6）：直接启动安装目录里的 exe（而非源码），
 * 通过渲染进程的 IPC 桥拿到 token 与 base URL，再调用健康检查与能力接口，
 * 输出 JSON 结论（含离线嵌入模型是否 ready）。
 *
 * 用法：
 *   node scripts/verify-package.mjs build/backend/pkb-backend/pkb-backend.exe?  # 不需要
 *   node scripts/verify-package.mjs release/win-unpacked/PersonalKnowledgeBase.exe
 */
const exePath = process.argv[2] ?? path.resolve('release/win-unpacked/PersonalKnowledgeBase.exe');
const userDataDir = mkdtempSync(path.join(tmpdir(), 'pkb-verify-'));
const dataDir = path.join(userDataDir, 'data');
let app;

function log(message, extra) {
  console.log(`[verify] ${message}`, extra ? JSON.stringify(extra) : '');
}

try {
  log('launch', { exePath, userDataDir });
  app = await electron.launch({
    executablePath: exePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, PKB_DATA_DIR: dataDir },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('#root');

  const deadline = Date.now() + 120_000;
  let status = null;
  while (Date.now() < deadline) {
    status = await page.evaluate(async () => {
      const bridge = globalThis.pkb;
      if (!bridge) {
        return null;
      }
      const bootstrap = await bridge.getBootstrap();
      return { state: bootstrap.backend.state, baseUrl: bootstrap.api_base_url, token: bootstrap.token };
    });
    if (status && status.state === 'ready') {
      break;
    }
    if (status && status.state === 'failed') {
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!status || status.state !== 'ready') {
    log('backend_not_ready', status && { state: status.state });
    process.exitCode = 1;
  } else {
    const result = await page.evaluate(async ({ baseUrl, token }) => {
      const headers = { Authorization: `Bearer ${token}` };
      const health = await fetch(`${baseUrl}/health`, { headers });
      const capabilities = await fetch(`${baseUrl}/system/capabilities`, { headers });
      const healthBody = await health.json();
      const capabilitiesBody = await capabilities.json();
      return {
        health: { status: health.status, body: healthBody },
        capabilities: { status: capabilities.status, data: capabilitiesBody.data },
      };
    }, { baseUrl: status.baseUrl, token: status.token });

    const embedding = result.capabilities.data?.embedding ?? null;
    const report = {
      backend_state: status.state,
      api_base_url: status.baseUrl,
      health_status: result.health.status,
      health: result.health.body,
      embedding,
      vector: result.capabilities.data?.vector ?? null,
      ai: result.capabilities.data?.ai ?? null,
    };
    log('report', report);
    if (result.health.status !== 200) {
      process.exitCode = 1;
    }
    if (!embedding || embedding.status !== 'ready') {
      log('embedding_not_ready', embedding);
    }
  }
} catch (error) {
  log('failed', { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  if (app) {
    await app.close().catch(() => undefined);
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
