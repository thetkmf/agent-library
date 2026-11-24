import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AppBootstrap,
  type AppInfo,
  type BackendStatus,
  type PkbBridge,
} from '../shared/ipc';

const channels = Object.values(IPC_CHANNELS);

const bridge: PkbBridge = {
  channels,
  getBootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap) as Promise<AppBootstrap>,
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>,
  restartBackend: () => ipcRenderer.invoke(IPC_CHANNELS.backendRestart) as Promise<BackendStatus>,
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<boolean>,
  onBackendStatus: (listener: (status: BackendStatus) => void) => {
    const handler = (_event: unknown, status: BackendStatus): void => listener(status);
    ipcRenderer.on(IPC_CHANNELS.backendStatus, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.backendStatus, handler);
    };
  },
};

// 只暴露白名单 API：不暴露 require / ipcRenderer / process
contextBridge.exposeInMainWorld('pkb', bridge);
