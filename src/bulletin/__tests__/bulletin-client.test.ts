// ---- Module mocks (must appear before any imports that load them) ----
const mockSignSubmitAndWatch = jest.fn();
const mockStoreTx = { signSubmitAndWatch: mockSignSubmitAndWatch };
const mockTxTransactionStorage = { store: jest.fn().mockReturnValue(mockStoreTx) };
const mockGetTypedApi = jest.fn().mockReturnValue({ tx: { TransactionStorage: mockTxTransactionStorage } });
const mockPapiDestroy = jest.fn();

jest.mock('polkadot-api', () => ({
  createClient: jest.fn().mockReturnValue({ getTypedApi: mockGetTypedApi, destroy: mockPapiDestroy }),
}));
jest.mock('polkadot-api/ws', () => ({
  getWsProvider: jest.fn().mockReturnValue({}),
}));
jest.mock('@polkadot/keyring', () => ({
  Keyring: jest.fn().mockImplementation(() => ({
    addFromJson: jest.fn().mockReturnValue({
      address: '5GTestAddress',
      publicKey: new Uint8Array(32).fill(1),
      sign: jest.fn().mockReturnValue(new Uint8Array(64)),
      decipher: jest.fn(),
    }),
  })),
}));
jest.mock('@polkadot/util-crypto', () => ({
  cryptoWaitReady: jest.fn().mockResolvedValue(true),
  blake2AsU8a: jest.fn().mockReturnValue(new Uint8Array(32).fill(2)),
}));
jest.mock('@polkadot-api/signer', () => ({
  getPolkadotSigner: jest.fn().mockReturnValue({}),
}));
jest.mock('multiformats/cid', () => ({
  CID: {
    createV1: jest.fn().mockReturnValue({ toString: () => 'bafyreiabc123def' }),
    parse: jest.fn().mockReturnValue({
      multihash: { code: 0xb220, digest: new Uint8Array(32).fill(2) },
    }),
  },
}));
jest.mock('multiformats/hashes/digest', () => ({
  create: jest.fn().mockReturnValue({}),
}));
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(
    JSON.stringify({
      address: '5GTestAddress',
      encoded: 'mockedBase64',
      encoding: { content: ['pkcs8', 'sr25519'], type: ['scrypt', 'xsalsa20-poly1305'], version: '3' },
      meta: { name: 'Test' },
    }),
  ),
}));
// Descriptor import is a no-op in tests
jest.mock('../../../.papi/descriptors/dist/index.js', () => ({ bulletin: {} }), { virtual: true });

import { BulletinClient } from '../BulletinClient';
import type { BulletinSettings } from '../types';

const SETTINGS: BulletinSettings = {
  bulletinEnabled: true,
  bulletinRpcUrl: 'wss://test.example.com',
  bulletinKeyfilePath: '/tmp/test.json',
  bulletinKeyfilePassword: 'testpass',
  bulletinIpfsGateway: 'https://ipfs.io/ipfs/',
  signalingUrls: ['wss://signaling.y-webrtc.com'],
  signalingFallbackTimeoutMs: 8000,
};

describe('BulletinClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: observable resolves immediately with an in-block event
    mockSignSubmitAndWatch.mockReturnValue({
      subscribe: (handlers: { next: (ev: any) => void; error: (e: Error) => void }) => {
        handlers.next({ type: 'txBestBlocksState', found: true });
        return { unsubscribe: jest.fn() };
      },
    });
  });

  test('store() connects, submits tx, and returns CID', async () => {
    const client = new BulletinClient(SETTINGS);
    const cid = await client.store(new TextEncoder().encode('hello'));
    expect(cid).toBe('bafyreiabc123def');
    expect(mockSignSubmitAndWatch).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  test('connect() is idempotent — double call creates only one PAPI client', async () => {
    const { createClient } = require('polkadot-api');
    const client = new BulletinClient(SETTINGS);
    await client.connect();
    await client.connect();
    expect(createClient).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  test('store() throws when the chain transaction fails', async () => {
    mockSignSubmitAndWatch.mockReturnValue({
      subscribe: (handlers: { next: (ev: any) => void; error: (e: Error) => void }) => {
        handlers.error(new Error('tx rejected'));
        return { unsubscribe: jest.fn() };
      },
    });
    const client = new BulletinClient(SETTINGS);
    await expect(client.store(new TextEncoder().encode('hello'))).rejects.toThrow('tx rejected');
    client.destroy();
  });

  test('fetch() GETs the IPFS gateway URL and returns bytes', async () => {
    const mockArrayBuffer = jest.fn().mockResolvedValue(new ArrayBuffer(3));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: mockArrayBuffer }) as any;

    const client = new BulletinClient(SETTINGS);
    const result = await client.fetch('bafyreiabc123def');

    expect(global.fetch).toHaveBeenCalledWith('https://ipfs.io/ipfs/bafyreiabc123def');
    expect(result).toBeInstanceOf(Uint8Array);
    client.destroy();
  });

  test('fetch() throws when gateway returns non-OK status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
    const client = new BulletinClient(SETTINGS);
    await expect(client.fetch('bafybadcid')).rejects.toThrow('IPFS fetch failed: 404');
    client.destroy();
  });
});

describe('BulletinClient.accountId', () => {
  test('returns SS58 address after connect()', async () => {
    const client = new BulletinClient(SETTINGS);
    await client.connect();
    expect(typeof client.accountId).toBe('string');
    expect(client.accountId.length).toBeGreaterThan(0);
    client.destroy();
  });

  test('throws before connect()', () => {
    const client = new BulletinClient(SETTINGS);
    expect(() => client.accountId).toThrow('Not connected');
  });
});

describe('BulletinClient.subscribeToStoredCids()', () => {
  const mockBestBlocksSubscribe = jest.fn();
  const mockGetValue = jest.fn();

  beforeEach(() => {
    const { createClient } = require('polkadot-api');
    createClient.mockReturnValue({
      getTypedApi: mockGetTypedApi,
      destroy: mockPapiDestroy,
      bestBlocks$: { subscribe: mockBestBlocksSubscribe },
    });
    mockGetTypedApi.mockReturnValue({
      tx: { TransactionStorage: mockTxTransactionStorage },
      query: {
        System: {
          Events: { getValue: mockGetValue },
        },
      },
    });
    mockBestBlocksSubscribe.mockReturnValue({ unsubscribe: jest.fn() });
  });

  test('calls cb with cid from TransactionStorage.Stored events', async () => {
    const storedEvent = {
      event: {
        type: 'TransactionStorage',
        value: { type: 'Stored', value: { cid: 'bafytest123' } },
      },
    };
    mockGetValue.mockResolvedValue([storedEvent]);
    mockBestBlocksSubscribe.mockImplementation((handler: any) => {
      handler([{ hash: '0xabc' }]);
      return { unsubscribe: jest.fn() };
    });

    const client = new BulletinClient(SETTINGS);
    await client.connect();

    const received: string[] = [];
    client.subscribeToStoredCids((cid) => received.push(cid));

    await new Promise((r) => setTimeout(r, 0));
    expect(received).toContain('bafytest123');
    client.destroy();
  });

  test('ignores non-Stored events', async () => {
    const otherEvent = {
      event: { type: 'System', value: { type: 'Remarked', value: {} } },
    };
    mockGetValue.mockResolvedValue([otherEvent]);
    mockBestBlocksSubscribe.mockImplementation((handler: any) => {
      handler([{ hash: '0xabc' }]);
      return { unsubscribe: jest.fn() };
    });

    const client = new BulletinClient(SETTINGS);
    await client.connect();

    const received: string[] = [];
    client.subscribeToStoredCids((cid) => received.push(cid));

    await new Promise((r) => setTimeout(r, 0));
    expect(received).toHaveLength(0);
    client.destroy();
  });

  test('unsubscribe function stops block watching', async () => {
    const unsub = jest.fn();
    mockBestBlocksSubscribe.mockReturnValue({ unsubscribe: unsub });
    mockGetValue.mockResolvedValue([]);

    const client = new BulletinClient(SETTINGS);
    await client.connect();

    const stop = client.subscribeToStoredCids(jest.fn());
    stop();
    expect(unsub).toHaveBeenCalledTimes(1);
    client.destroy();
  });
});
