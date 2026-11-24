import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { findFreePort } from '../../electron/lib/ports';

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

describe('findFreePort', () => {
  it('返回可监听的回环端口', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
    await expect(canListen(port)).resolves.toBe(true);
  });

  it('连续调用返回不同端口', async () => {
    const first = await findFreePort();
    const second = await findFreePort();
    expect(first).not.toBe(second);
  });
});
