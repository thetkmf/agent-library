import net from 'node:net';

export const LOOPBACK_HOST = '127.0.0.1';

/**
 * 向操作系统申请一个空闲的回环端口。
 * 先监听 0 由系统分配，再立即释放，随后交给后端进程使用。
 */
export function findFreePort(host: string = LOOPBACK_HOST): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => reject(error));
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('未能获取系统分配的端口')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
