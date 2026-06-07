const mockDestroy = jest.fn();
const mockCreateClient = jest.fn().mockReturnValue({ destroy: mockDestroy });

jest.mock('polkadot-api', () => ({ createClient: mockCreateClient }));
jest.mock('polkadot-api/ws', () => ({ getWsProvider: jest.fn().mockReturnValue({}) }));
jest.mock('@polkadot/util-crypto', () => ({ cryptoWaitReady: jest.fn().mockResolvedValue(true) }));

import { ChainConnection } from '../ChainConnection';

describe('ChainConnection', () => {
  beforeEach(() => jest.clearAllMocks());

  test('connect() transitions to connected and creates papi client', async () => {
    const conn = new ChainConnection('wss://test');
    expect(conn.state).toBe('idle');
    await conn.connect();
    expect(conn.state).toBe('connected');
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  test('connect() is idempotent — double call creates one client', async () => {
    const conn = new ChainConnection('wss://test');
    await conn.connect();
    await conn.connect();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  test('getClient() throws before connect()', () => {
    const conn = new ChainConnection('wss://test');
    expect(() => conn.getClient()).toThrow('[ChainConnection] Not connected');
  });

  test('getClient() returns client after connect()', async () => {
    const conn = new ChainConnection('wss://test');
    await conn.connect();
    expect(conn.getClient()).toBeDefined();
  });

  test('destroy() calls client.destroy() and resets to idle', async () => {
    const conn = new ChainConnection('wss://test');
    await conn.connect();
    conn.destroy();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(conn.state).toBe('idle');
  });

  test('destroy() is idempotent when called twice', async () => {
    const conn = new ChainConnection('wss://test');
    await conn.connect();
    conn.destroy();
    conn.destroy();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  test('connect() after failed state throws immediately', async () => {
    const { cryptoWaitReady } = require('@polkadot/util-crypto');
    (cryptoWaitReady as jest.Mock).mockRejectedValueOnce(new Error('crypto failed'));
    const conn = new ChainConnection('wss://test');
    await expect(conn.connect()).rejects.toThrow('crypto failed');
    expect(conn.state).toBe('failed');
    await expect(conn.connect()).rejects.toThrow('previously failed');
  });
});
