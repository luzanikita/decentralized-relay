import { RelayControlPlane } from '../RelayControlPlane';
import type { LiveTokenStore } from '../../LiveTokenStore';
import type { ClientToken } from '../../client/types';

const makeToken = (overrides: Partial<ClientToken> = {}): ClientToken => ({
  docId: 'room-abc',
  url: 'wss://relay.example.com',
  token: 'jwt-token',
  folder: 'folder-id',
  authorization: 'full',
  expiryTime: Date.now() + 60_000,
  ...overrides,
});

const makeMockStore = (token: ClientToken) => {
  return {
    getToken: jest.fn().mockResolvedValue(token),
  } as unknown as LiveTokenStore;
};

describe('RelayControlPlane', () => {
  test('maps ClientToken.docId → SessionParams.docId', async () => {
    const cp = new RelayControlPlane(makeMockStore(makeToken({ docId: 'room-xyz' })));
    const params = await cp.getSession('s3rn:relay:folder:00000000-0000-0000-0000-000000000001');
    expect(params.docId).toBe('room-xyz');
  });

  test('maps ClientToken.url → SessionParams.relayUrl', async () => {
    const cp = new RelayControlPlane(makeMockStore(makeToken({ url: 'wss://r.io' })));
    const params = await cp.getSession('s3rn:relay:folder:00000000-0000-0000-0000-000000000001');
    expect(params.relayUrl).toBe('wss://r.io');
  });

  test('maps ClientToken.token → SessionParams.relayToken', async () => {
    const cp = new RelayControlPlane(makeMockStore(makeToken({ token: 'my-jwt' })));
    const params = await cp.getSession('s3rn:relay:folder:00000000-0000-0000-0000-000000000001');
    expect(params.relayToken).toBe('my-jwt');
  });

  test('maps ClientToken.authorization → SessionParams.authorization', async () => {
    const cp = new RelayControlPlane(makeMockStore(makeToken({ authorization: 'read-only' })));
    const params = await cp.getSession('s3rn:relay:folder:00000000-0000-0000-0000-000000000001');
    expect(params.authorization).toBe('read-only');
  });

  test('defaults authorization to full when missing', async () => {
    const token = makeToken();
    delete (token as any).authorization;
    const cp = new RelayControlPlane(makeMockStore(token));
    const params = await cp.getSession('s3rn:relay:folder:00000000-0000-0000-0000-000000000001');
    expect(params.authorization).toBe('full');
  });

  test('passes resourceId to getToken', async () => {
    const mockStore = makeMockStore(makeToken());
    const cp = new RelayControlPlane(mockStore);
    await cp.getSession('my-resource-id');
    expect(mockStore.getToken).toHaveBeenCalledWith('my-resource-id', expect.any(String), expect.any(Function));
  });

  test('destroy() is a no-op and does not throw', () => {
    const cp = new RelayControlPlane(makeMockStore(makeToken()));
    expect(() => cp.destroy()).not.toThrow();
    expect(() => cp.destroy()).not.toThrow();
  });
});
