// ---- Module mocks ----
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockGetClient = jest.fn();
const mockConnectionDestroy = jest.fn();
const mockConnectionState = jest.fn().mockReturnValue('idle');

const mockChainConnection = {
  connect: mockConnect,
  getClient: mockGetClient,
  destroy: mockConnectionDestroy,
  get state() { return mockConnectionState(); },
};

const mockSignSubmitAndWatch = jest.fn();
const mockStoreTx = { signSubmitAndWatch: mockSignSubmitAndWatch };
const mockTxTransactionStorage = { store: jest.fn().mockReturnValue(mockStoreTx) };
const mockPapiDestroy = jest.fn();
const mockGetTypedApi = jest.fn().mockReturnValue({ tx: { TransactionStorage: mockTxTransactionStorage } });
const mockPapiClient = { getTypedApi: mockGetTypedApi, destroy: mockPapiDestroy };

jest.mock('@polkadot/util-crypto', () => ({
  cryptoWaitReady: jest.fn().mockResolvedValue(true),
  blake2AsU8a: jest.fn().mockReturnValue(new Uint8Array(32).fill(2)),
  encodeAddress: jest.fn().mockReturnValue('5GTestAddress'),
}));
jest.mock('@polkadot-api/signer', () => ({
  getPolkadotSigner: jest.fn().mockReturnValue({ publicKey: new Uint8Array(32).fill(1) }),
}));
jest.mock('multiformats/cid', () => ({
  CID: {
    createV1: jest.fn().mockReturnValue({ toString: () => 'bafyreiabc123def' }),
    parse: jest.fn().mockReturnValue({
      multihash: { code: 0xb220, digest: new Uint8Array(32).fill(2) },
    }),
  },
}));
jest.mock('multiformats/hashes/digest', () => ({ create: jest.fn().mockReturnValue({}) }));
jest.mock('../../../.papi/descriptors/dist/index.js', () => ({ bulletin: {} }), { virtual: true });

import { BulletinClient } from '../BulletinClient';
import type { PolkadotSigner } from 'polkadot-api';

const mockSigner: PolkadotSigner = { publicKey: new Uint8Array(32).fill(1) } as any;
const signerFactory = jest.fn().mockResolvedValue(mockSigner);

function makeClient() {
  return new BulletinClient(
    mockChainConnection as any,
    signerFactory,
    'https://ipfs.io/ipfs/',
  );
}

describe('BulletinClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClient.mockReturnValue(mockPapiClient);
    mockGetTypedApi.mockReturnValue({ tx: { TransactionStorage: mockTxTransactionStorage } });
    mockSignSubmitAndWatch.mockReturnValue({
      subscribe: (handlers: { next: (ev: any) => void; error: (e: Error) => void }) => {
        handlers.next({ type: 'txBestBlocksState', found: true });
        return { unsubscribe: jest.fn() };
      },
    });
  });

  test('store() connects, submits tx, and returns CID', async () => {
    const client = makeClient();
    const cid = await client.store(new TextEncoder().encode('hello'));
    expect(cid).toBe('bafyreiabc123def');
    expect(mockSignSubmitAndWatch).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  test('connect() is idempotent — double call invokes signerFactory once', async () => {
    const client = makeClient();
    await client.connect();
    await client.connect();
    expect(signerFactory).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  test('store() throws when the chain transaction fails', async () => {
    mockSignSubmitAndWatch.mockReturnValue({
      subscribe: (handlers: { next: (ev: any) => void; error: (e: Error) => void }) => {
        handlers.error(new Error('tx rejected'));
        return { unsubscribe: jest.fn() };
      },
    });
    const client = makeClient();
    await expect(client.store(new TextEncoder().encode('hello'))).rejects.toThrow('tx rejected');
    client.destroy();
  });

  test('fetch() GETs the IPFS gateway URL and returns bytes', async () => {
    const mockArrayBuffer = jest.fn().mockResolvedValue(new ArrayBuffer(3));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: mockArrayBuffer }) as any;
    const client = makeClient();
    const result = await client.fetch('bafyreiabc123def');
    expect(global.fetch).toHaveBeenCalledWith('https://ipfs.io/ipfs/bafyreiabc123def');
    expect(result).toBeInstanceOf(Uint8Array);
    client.destroy();
  });

  test('fetch() throws when gateway returns non-OK status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
    const client = makeClient();
    await expect(client.fetch('bafybadcid')).rejects.toThrow('IPFS fetch failed: 404');
    client.destroy();
  });

  test('destroy() calls connection.destroy()', async () => {
    const client = makeClient();
    await client.connect();
    client.destroy();
    expect(mockConnectionDestroy).toHaveBeenCalledTimes(1);
  });
});

describe('BulletinClient.accountId', () => {
  test('returns SS58 address after connect()', async () => {
    const client = makeClient();
    await client.connect();
    expect(client.accountId).toBe('5GTestAddress');
    client.destroy();
  });

  test('throws before connect()', () => {
    const client = makeClient();
    expect(() => client.accountId).toThrow('Not connected');
  });
});

describe('BulletinClient.subscribeToStoredCids()', () => {
  const mockBestBlocksSubscribe = jest.fn();
  const mockGetValue = jest.fn();

  beforeEach(() => {
    mockGetClient.mockReturnValue({
      getTypedApi: mockGetTypedApi,
      destroy: mockPapiDestroy,
      bestBlocks$: { subscribe: mockBestBlocksSubscribe },
    });
    mockGetTypedApi.mockReturnValue({
      tx: { TransactionStorage: mockTxTransactionStorage },
      query: { System: { Events: { getValue: mockGetValue } } },
    });
    mockBestBlocksSubscribe.mockReturnValue({ unsubscribe: jest.fn() });
  });

  test('calls cb with cid from TransactionStorage.Stored events', async () => {
    const storedEvent = {
      event: { type: 'TransactionStorage', value: { type: 'Stored', value: { cid: 'bafytest123' } } },
    };
    mockGetValue.mockResolvedValue([storedEvent]);
    mockBestBlocksSubscribe.mockImplementation((handler: any) => {
      handler([{ hash: '0xabc' }]);
      return { unsubscribe: jest.fn() };
    });

    const client = makeClient();
    await client.connect();
    const received: string[] = [];
    client.subscribeToStoredCids((cid) => received.push(cid));
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toContain('bafytest123');
    client.destroy();
  });

  test('ignores non-Stored events', async () => {
    const otherEvent = { event: { type: 'System', value: { type: 'Remarked', value: {} } } };
    mockGetValue.mockResolvedValue([otherEvent]);
    mockBestBlocksSubscribe.mockImplementation((handler: any) => {
      handler([{ hash: '0xabc' }]);
      return { unsubscribe: jest.fn() };
    });

    const client = makeClient();
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

    const client = makeClient();
    await client.connect();
    const stop = client.subscribeToStoredCids(jest.fn());
    stop();
    expect(unsub).toHaveBeenCalledTimes(1);
    client.destroy();
  });
});

