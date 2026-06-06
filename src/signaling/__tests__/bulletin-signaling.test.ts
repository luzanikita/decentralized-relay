// Mock 'ws' before importing the transport
const mockWssOn = jest.fn();
const mockWssSend = jest.fn();
const mockWssClose = jest.fn();
const mockServerListen = jest.fn();
const mockServerClose = jest.fn();
const mockServerAddress = jest.fn().mockReturnValue({ port: 54321 });

const mockWsClient = {
  send: mockWssSend,
  on: jest.fn(),
};

jest.mock('ws', () => ({
  WebSocketServer: jest.fn().mockImplementation(() => ({
    on: mockWssOn,
    close: mockWssClose,
  })),
}));

jest.mock('http', () => ({
  createServer: jest.fn().mockReturnValue({
    listen: mockServerListen,
    close: mockServerClose,
    address: mockServerAddress,
  }),
}));

import { BulletinSignalingTransport } from '../BulletinSignalingTransport';

const makeMockClient = () => ({
  accountId: '5GTestAddress',
  connect: jest.fn().mockResolvedValue(undefined),
  store: jest.fn().mockResolvedValue('bafytest123'),
  fetch: jest.fn(),
  subscribeToStoredCids: jest.fn().mockReturnValue(jest.fn()),
});

// Helper: trigger the server 'listening' callback so signalingUrls populate
function triggerServerReady(transport: BulletinSignalingTransport) {
  const listenCall = mockServerListen.mock.calls[0];
  const callback = listenCall[2]; // listen(port, host, callback)
  callback();
}

// Helper: trigger a WS connection
function triggerWsConnection(ws = mockWsClient) {
  const connectionCb = mockWssOn.mock.calls.find(([ev]: [string]) => ev === 'connection')?.[1];
  if (connectionCb) connectionCb(ws);
}

// Helper: simulate receiving a message from y-webrtc
function triggerMessage(transport: BulletinSignalingTransport, msg: object) {
  const ws = { ...mockWsClient, on: jest.fn() };
  triggerWsConnection(ws);
  const msgCb = (ws.on as jest.Mock).mock.calls.find(([ev]: [string]) => ev === 'message')?.[1];
  if (msgCb) msgCb(JSON.stringify(msg));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockServerAddress.mockReturnValue({ port: 54321 });
  mockServerListen.mockImplementation((_port: number, _host: string, cb: () => void) => cb());
  mockWssOn.mockImplementation((event: string, cb: (...args: any[]) => void) => {
    // Store for later triggering
  });
});

describe('BulletinSignalingTransport construction', () => {
  test('signalingUrls is populated after server listens', async () => {
    const t = await BulletinSignalingTransport.create(makeMockClient() as any);
    expect(t.signalingUrls).toEqual(['ws://127.0.0.1:54321']);
  });
});

describe('BulletinSignalingTransport outbound', () => {
  test('publish message stores envelope on chain', async () => {
    const client = makeMockClient();
    const t = await BulletinSignalingTransport.create(client as any);

    triggerMessage(t, {
      type: 'publish',
      topic: 'doc-abc',
      data: { type: 'offer', sdp: 'v=0' },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(client.store).toHaveBeenCalledTimes(1);
    const storedBytes = client.store.mock.calls[0][0] as Uint8Array;
    const envelope = JSON.parse(new TextDecoder().decode(storedBytes));
    expect(envelope.d).toBe('doc-abc');
    expect(envelope.f).toBe('5GTestAddress');
    expect(envelope.p).toEqual({ type: 'offer', sdp: 'v=0' });
  });

  test('awareness publish is dropped and not stored', async () => {
    const client = makeMockClient();
    const t = await BulletinSignalingTransport.create(client as any);

    triggerMessage(t, {
      type: 'publish',
      topic: 'doc-abc',
      data: { type: 'awareness', added: [], updated: [], removed: [] },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(client.store).not.toHaveBeenCalled();
  });
});

describe('BulletinSignalingTransport inbound', () => {
  test('matching envelope forwarded to WS client', async () => {
    const client = makeMockClient();
    let storedCb: ((cid: string) => void) | null = null;
    client.subscribeToStoredCids.mockImplementation((cb: (cid: string) => void) => {
      storedCb = cb;
      return jest.fn();
    });

    const envelope = { d: 'doc-abc', f: '5GOtherAddress', p: { type: 'answer', sdp: 'v=0' } };
    client.fetch.mockResolvedValue(new TextEncoder().encode(JSON.stringify(envelope)));

    const t = await BulletinSignalingTransport.create(client as any);

    // Subscribe to room
    triggerMessage(t, { type: 'subscribe', topics: ['doc-abc'] });
    await new Promise((r) => setTimeout(r, 0));

    // Simulate inbound CID
    storedCb!('bafytest456');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockWssSend).toHaveBeenCalledWith(
      JSON.stringify({ type: 'message', from: '5GOtherAddress', data: { type: 'answer', sdp: 'v=0' } })
    );
  });

  test('own-account envelope is not forwarded', async () => {
    const client = makeMockClient();
    let storedCb: ((cid: string) => void) | null = null;
    client.subscribeToStoredCids.mockImplementation((cb: (cid: string) => void) => {
      storedCb = cb;
      return jest.fn();
    });

    const envelope = { d: 'doc-abc', f: '5GTestAddress', p: { type: 'offer' } };
    client.fetch.mockResolvedValue(new TextEncoder().encode(JSON.stringify(envelope)));

    const t = await BulletinSignalingTransport.create(client as any);
    triggerMessage(t, { type: 'subscribe', topics: ['doc-abc'] });
    await new Promise((r) => setTimeout(r, 0));

    storedCb!('bafytest789');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockWssSend).not.toHaveBeenCalled();
  });

  test('wrong-room envelope is not forwarded', async () => {
    const client = makeMockClient();
    let storedCb: ((cid: string) => void) | null = null;
    client.subscribeToStoredCids.mockImplementation((cb: (cid: string) => void) => {
      storedCb = cb;
      return jest.fn();
    });

    const envelope = { d: 'doc-OTHER', f: '5GOtherAddress', p: { type: 'offer' } };
    client.fetch.mockResolvedValue(new TextEncoder().encode(JSON.stringify(envelope)));

    const t = await BulletinSignalingTransport.create(client as any);
    triggerMessage(t, { type: 'subscribe', topics: ['doc-abc'] });
    await new Promise((r) => setTimeout(r, 0));

    storedCb!('bafytest000');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockWssSend).not.toHaveBeenCalled();
  });
});

describe('BulletinSignalingTransport teardown', () => {
  test('destroy() closes server and cancels block subscription', async () => {
    const client = makeMockClient();
    const unsubscribe = jest.fn();
    client.subscribeToStoredCids.mockReturnValue(unsubscribe);

    const t = await BulletinSignalingTransport.create(client as any);
    triggerMessage(t, { type: 'subscribe', topics: ['doc-abc'] });
    await new Promise((r) => setTimeout(r, 0));

    t.destroy();

    expect(mockServerClose).toHaveBeenCalledTimes(1);
    expect(mockWssClose).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('destroy() is idempotent', async () => {
    const t = await BulletinSignalingTransport.create(makeMockClient() as any);
    t.destroy();
    expect(() => t.destroy()).not.toThrow();
  });
});
