import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureApi, resetApiConfig } from '@/api/config';
import { openSseStream, parseEventFrame, splitFrames } from '@/api/sse';
import type { SseEvent } from '@/api/sse';

const encoder = new TextEncoder();

function sseResponse(chunks: string[]): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index] ?? ''));
      index += 1;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function errorResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    }),
    { status: 200 },
  );
}

function setupFetch(impl: (init: RequestInit) => Promise<Response> | Response): () => number {
  let callCount = 0;
  configureApi({
    baseUrl: 'http://127.0.0.1:52341/api/v1',
    token: 'local-token',
    fetchImpl: async (_input, init) => {
      callCount += 1;
      return impl(init ?? {});
    },
    sleep: async () => undefined,
    random: () => 0.5,
  });
  return () => callCount;
}

afterEach(() => {
  resetApiConfig();
});

describe('splitFrames', () => {
  it('按空行切帧并保留未完成缓冲', () => {
    const { frames, rest } = splitFrames('event: a\ndata: 1\n\ndata: 2\n\npartial');
    expect(frames).toEqual(['event: a\ndata: 1', 'data: 2']);
    expect(rest).toBe('partial');
  });

  it('兼容 CRLF 与心跳注释', () => {
    const { frames, rest } = splitFrames(': ping\r\n\r\ndata: hi\r\n\r\n');
    expect(frames).toEqual([': ping', 'data: hi']);
    expect(rest).toBe('');
  });
});

describe('parseEventFrame', () => {
  it('解析 event / data / id，多行 data 以换行拼接', () => {
    const event = parseEventFrame('event: message.delta\nid: 7\ndata: {"a":1}\ndata: 附加');
    expect(event).toEqual({ event: 'message.delta', id: '7', data: '{"a":1}\n附加' });
  });

  it('未声明 event 时默认 message', () => {
    expect(parseEventFrame('data: hi')).toEqual({ event: 'message', id: null, data: 'hi' });
  });

  it('仅注释或无 data 的帧返回 null', () => {
    expect(parseEventFrame(': ping')).toBeNull();
    expect(parseEventFrame('event: noop')).toBeNull();
  });
});

describe('openSseStream', () => {
  it('分块到达时正确拼帧，忽略心跳并解析事件', async () => {
    setupFetch(() =>
      sseResponse([
        ': ping\n\n',
        'event: message.delta\ndata: {"delta":"你"}\n\n',
        'event: message.delta\ndata: {"delta":"好"}\n\nevent: message.completed\ndata: {"finish_reason":"stop"}\n\n',
      ]),
    );

    const events: SseEvent[] = [];
    const handle = openSseStream('/agent/chat', {
      maxRetries: 0,
      onEvent: (event) => events.push(event),
    });
    await handle.done;

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ event: 'message.delta', id: null, data: '{"delta":"你"}' });
    expect(events[2]?.event).toBe('message.completed');
  });

  it('网络中断后按次重连，恢复连接后继续收到事件', async () => {
    let call = 0;
    const notifyError = vi.fn();
    setupFetch(() => {
      call += 1;
      if (call === 1) {
        return errorResponse();
      }
      return sseResponse(['data: 恢复\n\n']);
    });

    const events: SseEvent[] = [];
    const handle = openSseStream('/events/stream', {
      maxRetries: 2,
      initialDelayMs: 1,
      onEvent: (event) => events.push(event),
      onError: notifyError,
    });
    await handle.done;

    expect(call).toBe(2);
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.data)).toEqual(['恢复']);
  });

  it('重连次数耗尽后放弃并关闭', async () => {
    const onClose = vi.fn();
    const onError = vi.fn();
    const calls = setupFetch(() => errorResponse());

    const handle = openSseStream('/events/stream', {
      maxRetries: 1,
      initialDelayMs: 1,
      onEvent: () => undefined,
      onError,
      onClose,
    });
    await handle.done;

    expect(calls()).toBe(2); // 首次 + 1 次重试
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('服务端正常关闭视为完成，不重连', async () => {
    const calls = setupFetch(() => sseResponse(['data: done\n\n']));
    const onError = vi.fn();
    const onClose = vi.fn();

    const handle = openSseStream('/events/stream', {
      maxRetries: 3,
      initialDelayMs: 1,
      onEvent: () => undefined,
      onError,
      onClose,
    });
    await handle.done;

    expect(calls()).toBe(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('命中终止事件后主动结束（服务端未关闭也退出）', async () => {
    setupFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('event: message.completed\ndata: {}\n\n'));
              // 故意不关闭，模拟服务端保持连接
            },
          }),
          { status: 200 },
        ),
    );

    const events: string[] = [];
    const handle = openSseStream('/agent/chat', {
      terminalEvents: ['message.completed'],
      maxRetries: 5,
      initialDelayMs: 1,
      onEvent: (event) => events.push(event.event),
    });
    await handle.done;

    expect(events).toEqual(['message.completed']);
  });

  it('close() 可取消进行中的流', async () => {
    setupFetch(
      (init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init.signal?.addEventListener('abort', () => {
                controller.error(new DOMException('aborted', 'AbortError'));
              });
            },
          }),
          { status: 200 },
        ),
    );

    const onClose = vi.fn();
    const onError = vi.fn();
    const handle = openSseStream('/events/stream', {
      maxRetries: 3,
      initialDelayMs: 1,
      onEvent: () => undefined,
      onError,
      onClose,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    handle.close();
    await handle.done;

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('401 只触发一次 onError，不做无意义重连', async () => {
    setupFetch(() => new Response('unauthorized', { status: 401 }));
    const onError = vi.fn();

    const handle = openSseStream('/agent/chat', {
      maxRetries: 3,
      initialDelayMs: 1,
      onEvent: () => undefined,
      onError,
    });
    await handle.done;

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: 'auth', httpStatus: 401 });
  });
});
