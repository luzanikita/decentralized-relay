const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { PublicFaucetClient } from '../PublicFaucetClient';

function makeTextResponse(lines: unknown[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(
      lines.map((l) => JSON.stringify(l)).join('\n'),
    ),
  } as unknown as Response;
}

const mockSignBytes = jest.fn().mockResolvedValue(new Uint8Array(64).fill(0xab));

beforeEach(() => jest.clearAllMocks());

describe('PublicFaucetClient.forRpcUrl()', () => {
  test('returns WESTEND config for a westend URL', () => {
    const cfg = PublicFaucetClient.forRpcUrl('wss://westend-bulletin-rpc.polkadot.io');
    expect(cfg.parachainId).toBe('2487');
    expect(cfg.symbol).toBe('WND');
    expect(cfg.decimals).toBe(12);
  });

  test('returns PASEO config for a paseo URL', () => {
    const cfg = PublicFaucetClient.forRpcUrl('wss://paseo-bulletin-rpc.polkadot.io');
    expect(cfg.parachainId).toBe('5118');
    expect(cfg.symbol).toBe('PAS');
    expect(cfg.decimals).toBe(10);
  });

  test('defaults to WESTEND for an unknown URL', () => {
    const cfg = PublicFaucetClient.forRpcUrl('wss://unknown.example.com');
    expect(cfg.parachainId).toBe('2487');
    expect(cfg.symbol).toBe('WND');
    expect(cfg.decimals).toBe(12);
  });
});

describe('PublicFaucetClient.requestFaucetGrant()', () => {
  test('returns ok:true when last NDJSON line has hash', async () => {
    mockFetch.mockResolvedValue(
      makeTextResponse([{ status: 'processing' }, { hash: '0xabc', blockHash: '0xdef' }]),
    );
    const client = new PublicFaucetClient('5GTestAddr', mockSignBytes, PublicFaucetClient.WESTEND);
    const result = await client.requestFaucetGrant();
    expect(result).toEqual({ ok: true, granted: 0n });
  });

  test('returns rate_limited when last NDJSON line has quota error', async () => {
    mockFetch.mockResolvedValue(
      makeTextResponse([{ error: 'quota exceeded for this account' }]),
    );
    const client = new PublicFaucetClient('5GTestAddr', mockSignBytes, PublicFaucetClient.WESTEND);
    const result = await client.requestFaucetGrant();
    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });

  test('returns faucet_unavailable when last NDJSON line has non-quota error', async () => {
    mockFetch.mockResolvedValue(
      makeTextResponse([{ error: 'internal server error' }]),
    );
    const client = new PublicFaucetClient('5GTestAddr', mockSignBytes, PublicFaucetClient.WESTEND);
    const result = await client.requestFaucetGrant();
    expect(result).toEqual({ ok: false, reason: 'faucet_unavailable' });
  });

  test('returns faucet_unavailable on HTTP non-2xx', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    const client = new PublicFaucetClient('5GTestAddr', mockSignBytes, PublicFaucetClient.WESTEND);
    const result = await client.requestFaucetGrant();
    expect(result).toEqual({ ok: false, reason: 'faucet_unavailable' });
  });

  test('returns network_error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const client = new PublicFaucetClient('5GTestAddr', mockSignBytes, PublicFaucetClient.WESTEND);
    const result = await client.requestFaucetGrant();
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });

  test('POST body has correct address, parachain_id, faucet: message, and 0x signature', async () => {
    mockFetch.mockResolvedValue(makeTextResponse([{ hash: '0xabc' }]));
    const client = new PublicFaucetClient('5GMyAddress', mockSignBytes, PublicFaucetClient.WESTEND);
    await client.requestFaucetGrant();

    expect(mockFetch).toHaveBeenCalledWith(
      PublicFaucetClient.WESTEND.endpoint,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        }),
      }),
    );

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.address).toBe('5GMyAddress');
    expect(body.parachain_id).toBe('2487');
    expect(body.message).toMatch(/^faucet:5GMyAddress:\d+$/);
    expect(body.signature).toMatch(/^0x/);
  });

  test('signBytes is called with the UTF-8 bytes of the message sent in the POST body', async () => {
    mockFetch.mockResolvedValue(makeTextResponse([{ hash: '0xabc' }]));
    const client = new PublicFaucetClient('5GMyAddress', mockSignBytes, PublicFaucetClient.WESTEND);
    await client.requestFaucetGrant();

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(mockSignBytes).toHaveBeenCalledTimes(1);
    const signed = mockSignBytes.mock.calls[0][0] as Uint8Array;
    expect(new TextDecoder().decode(signed)).toBe(body.message);
  });
});
