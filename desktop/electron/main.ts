import path from 'node:path';
import { app, BrowserWindow, Menu, session } from 'electron';
import { createLogger, type Logger } from './lib/logger';
import { createAppPaths, type AppPaths } from './lib/paths';
import { TokenStore, type StoredToken } from './lib/token-store';
import { electronSecretBox } from './lib/safe-storage';
import { BackendManager, resolveBackendLaunch } from './lib/backend-process';
import { hardenApp, hardenSession, hardenWindow } from './lib/security';
import { runSmokeCheck } from './lib/smoke';
import { broadcastBackendStatus, registerIpcHandlers } from './ipc/handlers';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL?.trim() ?? '';
const IS_DEV = !app.isPackaged;

interface Runtime {
  paths: AppPaths;
  logger: Logger;
  token: StoredToken;
  backend: BackendManager;
}

let mainWindow: BrowserWindow | null = null;
let runtime: Runtime | null = null;
let disposeIpc: (() => void) | null = null;
let isQuitting = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f6f7f9',
    title: '个人专属智能知识库',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      devTools: IS_DEV,
    },
  });

  hardenWindow(window, { allowDevTools: IS_DEV });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  return window;
}

async function bootstrap(): Promise<void> {
  // 主进程运行时环境：userData 目录、日志、token、后端进程
  const paths = createAppPaths({
    userDataDir: app.getPath('userData'),
    dataDirOverride: process.env.PKB_DATA_DIR,
  });

  const logger = createLogger({
    filePath: paths.logFile,
    minLevel: IS_DEV ? 'debug' : 'info',
    mirrorToConsole: IS_DEV,
  });

  logger.info('app.starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    is_dev: IS_DEV,
    data_dir: paths.dataDir,
  });

  const tokenStore = new TokenStore({ filePath: paths.tokenFile, box: electronSecretBox });
  const token = tokenStore.ensure();
  logger.addSecret(token.token);
  if (!token.secure) {
    logger.warn('token.insecure_fallback', { reason: 'safeStorage unavailable' });
  }

  const launch = resolveBackendLaunch({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    projectRoot: path.resolve(__dirname, '..', '..', '..'),
    env: process.env,
  });

  const backend = new BackendManager({
    launch,
    token: token.token,
    dataDir: paths.dataDir,
    logFile: paths.logFile,
    logger,
    onChange: (status) => broadcastBackendStatus(mainWindow, status),
  });

  runtime = { paths, logger, token, backend };

  hardenApp({
    devServerUrl: DEV_SERVER_URL || undefined,
    isPackaged: app.isPackaged,
    onBlocked: (reason, detail) => logger.warn('security.blocked', { reason, detail }),
  });

  hardenSession(session.defaultSession, (permission) => {
    logger.warn('security.permission_denied', { permission });
  });

  disposeIpc = registerIpcHandlers({
    getWindow: () => mainWindow,
    backend,
    getToken: () => runtime?.token.token ?? '',
    isTokenSecure: () => runtime?.token.secure ?? false,
    dataDir: paths.dataDir,
    logFile: paths.logFile,
    isDev: IS_DEV,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    logger,
  });

  mainWindow = createWindow();

  if (DEV_SERVER_URL) {
    logger.info('app.dev_server', { url: DEV_SERVER_URL });
  } else {
    Menu.setApplicationMenu(null);
  }

  if (process.env.PKB_SMOKE === '1') {
    runSmokeCheck(mainWindow, logger);
  }

  // 窗口先展示，再启动后端，避免用户看到空白等待
  void backend.start();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(
    () => {
      void bootstrap().catch((error: unknown) => {
        runtime?.logger.error('app.bootstrap_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        app.quit();
      });
    },
    (error: unknown) => {
      console.error('Electron 启动失败', error);
      app.quit();
    },
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (isQuitting) {
      return;
    }
    isQuitting = true;
    event.preventDefault();
    const current = runtime;
    const finish = (): void => {
      disposeIpc?.();
      disposeIpc = null;
      app.quit();
    };
    if (current) {
      current.logger.info('app.quitting');
      void current.backend.stop().finally(finish);
    } else {
      finish();
    }
  });
}

process.on('uncaughtException', (error) => {
  runtime?.logger.error('process.uncaught_exception', { message: error.message });
});

process.on('unhandledRejection', (reason) => {
  runtime?.logger.error('process.unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
  });
});
