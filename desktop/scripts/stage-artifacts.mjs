import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * F12/F13：把后端 sidecar 与离线嵌入模型暂存到 desktop/build/，
 * 供 electron-builder 的 extraResources 使用（产物不提交仓库）。
 *
 * 来源优先级：
 *   sidecar：--backend <dir> > 环境 PKB_BACKEND_DIST > ../后端-test-tube-langchain/backend/dist/pkb-backend
 *   模型：  --model <dir>   > 环境 PKB_MODEL_DIR > %LOCALAPPDATA%/pkb-build-cache/bge-small-zh-v1.5
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const skipModel = args.includes('--skip-model');
const backendSource =
  flag('--backend') ??
  process.env.PKB_BACKEND_DIST ??
  path.resolve(root, '../../后端-test-tube-langchain/backend/dist/pkb-backend');
const modelSource =
  flag('--model') ??
  process.env.PKB_MODEL_DIR ??
  path.join(process.env.LOCALAPPDATA ?? '', 'pkb-build-cache', 'bge-small-zh-v1.5');

const MODEL_SHA256 = {
  'model_optimized.onnx': '1294ea4b6331115a353d81f96b85e8c8d7fdcc284453d5b2fab5b016230aad38',
  'tokenizer.json': '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26',
  'vocab.txt': '45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c',
  'config.json': '9088751d39abbf86ec3d19ffca92ad62ad19075f7e59712e6c71217fa125d1d3',
  'tokenizer_config.json': 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a',
  'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
  'ort_config.json': '97e78d1d21c2eb719e865b018f17915df6a12ed987446eb7f3f3a783a5afb1e1',
};

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function assertDir(dir, label) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`[stage] 缺少${label}：${dir}`);
    process.exit(1);
  }
}

const backendTarget = path.join(root, 'build', 'backend', 'pkb-backend');
console.log(`[stage] sidecar: ${backendSource} → ${backendTarget}`);
assertDir(backendSource, '后端 sidecar');
const exe = path.join(backendSource, process.platform === 'win32' ? 'pkb-backend.exe' : 'pkb-backend');
if (!existsSync(exe)) {
  console.error(`[stage] sidecar 内未找到可执行文件：${exe}`);
  process.exit(1);
}
rmSync(backendTarget, { recursive: true, force: true });
mkdirSync(path.dirname(backendTarget), { recursive: true });
cpSync(backendSource, backendTarget, { recursive: true });

const modelTarget = path.join(root, 'build', 'models', 'bge-small-zh-v1.5');
if (skipModel) {
  console.log('[stage] 跳过模型暂存');
} else {
  console.log(`[stage] model: ${modelSource} → ${modelTarget}`);
  assertDir(modelSource, '离线嵌入模型');
  for (const [name, expected] of Object.entries(MODEL_SHA256)) {
    const file = path.join(modelSource, name);
    if (!existsSync(file)) {
      console.error(`[stage] 模型文件缺失：${name}`);
      process.exit(1);
    }
    const actual = sha256(file);
    if (actual !== expected) {
      console.error(`[stage] 模型哈希不匹配：${name}\n  期望 ${expected}\n  实际 ${actual}`);
      process.exit(1);
    }
  }
  rmSync(modelTarget, { recursive: true, force: true });
  mkdirSync(path.dirname(modelTarget), { recursive: true });
  cpSync(modelSource, modelTarget, { recursive: true });
  console.log('[stage] 模型 sha256 校验通过');
}

writeFileSync(
  path.join(root, 'build', 'STAGED.json'),
  JSON.stringify(
    {
      staged_at: new Date().toISOString(),
      backend: { source: backendSource, files: statSync(backendTarget).size },
      model: skipModel ? null : { source: modelSource, sha256: MODEL_SHA256 },
    },
    null,
    2,
  ),
);
console.log('[stage] 完成');
