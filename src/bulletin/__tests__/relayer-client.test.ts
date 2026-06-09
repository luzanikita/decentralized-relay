const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { RelayerClient } from '../RelayerClient';

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => jest.clearAllMocks());

describe('RelayerClient.requestFaucetGrant()', () => {
  test('returns ok:true with granted as bigint on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse({ granted: '5000000000000' }));
    const client = new RelayerClient('https://relay.example.com');
    const result = await client.requestFaucetGrant('5GTestAddress', 'bulletin-westend');
    expect(result).toEqual({ ok: true, granted: 5_000_000_000_000n });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://relay.example.com/faucet-grant',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ masterAccountAddress: '5GTestAddress', chainNetworkId: 'bulletin-westend' }),
      }),
    );
  });

  test('returns rate_limited on 429', async () => {
    mockFetch.mockResolvedValue(makeResponse({ retryAfter: '2026-07-01T00:00:00Z' }, 429));
    const client = new RelayerClient('https://relay.example.com');
    const result = await client.requestFaucetGrant('5GTestAddress', 'bulletin-westend');
    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });

  test('returns faucet_unavailable on 503', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, 503));
    const client = new RelayerClient('https://relay.example.com');
    const result = await client.requestFaucetGrant('5GTestAddress', 'bulletin-westend');
    expect(result).toEqual({ ok: false, reason: 'faucet_unavailable' });
  });

  test('returns faucet_unavailable on any non-429 non-2xx', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, 500));
    const client = new RelayerClient('https://relay.example.com');
    const result = await client.requestFaucetGrant('5GTestAddress', 'bulletin-westend');
    expect(result).toEqual({ ok: false, reason: 'faucet_unavailable' });
  });

  test('returns network_error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const client = new RelayerClient('https://relay.example.com');
    const result = await client.requestFaucetGrant('5GTestAddress', 'bulletin-westend');
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });
});

describe('RelayerClient.topUpNow()', () => {
  test('returns ok:true with sent and remainingBudget on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse({ sent: '3000000000000', remainingBudget: '7000000000000' }));
    const client = new RelayerClient('https://relay.example.com', 'my-secret-token');
    const result = await client.topUpNow();
    expect(result).toEqual({ ok: true, sent: 3_000_000_000_000n, remainingBudget: 7_000_000_000_000n });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://relay.example.com/top-up-now',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer my-secret-token' }),
      }),
    );
  });

  test('returns invalid_token immediately without fetching when no subscriptionToken', async () => {
    const client = new RelayerClient('https://relay.example.com');
    const result = await client.topUpNow();
    expect(result).toEqual({ ok: false, reason: 'invalid_token' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns invalid_token on 401', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, 401));
    const client = new RelayerClient('https://relay.example.com', 'bad-token');
    const result = await client.topUpNow();
    expect(result).toEqual({ ok: false, reason: 'invalid_token' });
  });

  test('returns inactive on 402', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, 402));
    const client = new RelayerClient('https://relay.example.com', 'token');
    const result = await client.topUpNow();
    expect(result).toEqual({ ok: false, reason: 'inactive' });
  });

  test('returns budget_exhausted on 429', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, 429));
    const client = new RelayerClient('https://relay.example.com', 'token');
    const result = await client.topUpNow();
    expect(result).toEqual({ ok: false, reason: 'budget_exhausted' });
  });

  test('returns network_error on any other non-2xx', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, 500));
    const client = new RelayerClient('https://relay.example.com', 'token');
    const result = await client.topUpNow();
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });

  test('returns network_error when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    const client = new RelayerClient('https://relay.example.com', 'token');
    const result = await client.topUpNow();
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });
});

describe('RelayerClient.getStatus()', () => {
  test('returns StatusResult on 200', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 'active',
      remainingBudget: '7000000000000',
      periodResetsAt: '2026-07-01T00:00:00.000Z',
    }));
    const client = new RelayerClient('https://relay.example.com', 'token');
    const result = await client.getStatus();
    expect(result).toEqual({
      status: 'active',
      remainingBudget: 7_000_000_000_000n,
      periodResetsAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://relay.example.com/status',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
    );
  });

  test('returns null immediately without fetching when no subscriptionToken', async () => {
    const client = new RelayerClient('https://relay.example.com');
    const result = await client.getStatus();
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns null on non-OK response', async () => {
    mockFetch.mockResolvedValue(makeResponse({}, 401));
    const client = new RelayerClient('https://relay.example.com', 'token');
    const result = await client.getStatus();
    expect(result).toBeNull();
  });

  test('returns null when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const client = new RelayerClient('https://relay.example.com', 'token');
    const result = await client.getStatus();
    expect(result).toBeNull();
  });
});
