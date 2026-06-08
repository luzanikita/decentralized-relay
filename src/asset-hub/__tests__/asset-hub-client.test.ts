const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockAddProxySignAndSubmit = jest.fn().mockResolvedValue({ ok: true });
const mockRemoveProxySignAndSubmit = jest.fn().mockResolvedValue({ ok: true });
const mockAddProxyTx = { signAndSubmit: mockAddProxySignAndSubmit };
const mockRemoveProxyTx = { signAndSubmit: mockRemoveProxySignAndSubmit };
const mockProxyAdd = jest.fn().mockReturnValue(mockAddProxyTx);
const mockProxyRemove = jest.fn().mockReturnValue(mockRemoveProxyTx);
const mockProxiesGetValue = jest.fn();

const mockTypedApi = {
  tx: {
    Proxy: {
      add_proxy: mockProxyAdd,
      remove_proxy: mockProxyRemove,
    },
  },
  query: {
    Proxy: {
      Proxies: { getValue: mockProxiesGetValue },
    },
  },
};

const mockGetTypedApi = jest.fn().mockReturnValue(mockTypedApi);
const mockGetClient = jest.fn().mockReturnValue({ getTypedApi: mockGetTypedApi });
const mockChainConnection = {
  connect: mockConnect,
  getClient: mockGetClient,
  destroy: jest.fn(),
};

jest.mock('@polkadot/util-crypto', () => ({
  encodeAddress: jest.fn().mockImplementation((bytes: Uint8Array) => '5G' + Buffer.from(bytes).toString('hex').slice(0, 10)),
}));
jest.mock('../../../.papi/descriptors/dist/index.js', () => ({ westend_asset_hub: {} }), { virtual: true });

import { AssetHubClient } from '../AssetHubClient';

const mockMasterSigner = { publicKey: new Uint8Array(32).fill(9) } as any;

describe('AssetHubClient', () => {
  beforeEach(() => jest.clearAllMocks());

  test('addProxy() connects and calls Proxy.add_proxy with correct args', async () => {
    const client = new AssetHubClient(mockChainConnection as any);
    await client.addProxy('5GDeviceAddress', mockMasterSigner);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockProxyAdd).toHaveBeenCalledWith({
      delegate: { type: 'Id', value: '5GDeviceAddress' },
      proxy_type: 'NonTransfer',
      delay: 0,
    });
    expect(mockAddProxySignAndSubmit).toHaveBeenCalledWith(mockMasterSigner);
  });

  test('removeProxy() calls Proxy.remove_proxy with correct args', async () => {
    const client = new AssetHubClient(mockChainConnection as any);
    await client.removeProxy('5GDeviceAddress', mockMasterSigner);
    expect(mockProxyRemove).toHaveBeenCalledWith({
      delegate: { type: 'Id', value: '5GDeviceAddress' },
      proxy_type: 'NonTransfer',
      delay: 0,
    });
    expect(mockRemoveProxySignAndSubmit).toHaveBeenCalledWith(mockMasterSigner);
  });

  test('getProxies() returns parsed ProxyEntry list', async () => {
    mockProxiesGetValue.mockResolvedValue([
      [
        { delegate: new Uint8Array(32).fill(5), proxy_type: { type: 'Any' }, delay: 0 },
      ],
    ]);
    const client = new AssetHubClient(mockChainConnection as any);
    const proxies = await client.getProxies('5GMasterAddress');
    expect(proxies).toHaveLength(1);
    expect(proxies[0].proxyType).toBe('Any');
    expect(proxies[0].delay).toBe(0);
    expect(typeof proxies[0].delegate).toBe('string');
  });

  test('getProxies() returns empty array when no proxies exist', async () => {
    mockProxiesGetValue.mockResolvedValue([[]]);
    const client = new AssetHubClient(mockChainConnection as any);
    const proxies = await client.getProxies('5GMasterAddress');
    expect(proxies).toHaveLength(0);
  });

  test('destroy() calls connection.destroy()', () => {
    const client = new AssetHubClient(mockChainConnection as any);
    client.destroy();
    expect(mockChainConnection.destroy).toHaveBeenCalledTimes(1);
  });

  test('addFolderMember maps full → NonTransfer', async () => {
    const client = new AssetHubClient(mockChainConnection as any);
    const folderSigner = { publicKey: new Uint8Array(32) } as any;
    await client.addFolderMember('5GFolderAddr', '5GMemberAddr', 'full', folderSigner);
    expect(mockProxyAdd).toHaveBeenCalledWith({
      delegate: { type: 'Id', value: '5GMemberAddr' },
      proxy_type: 'NonTransfer',
      delay: 0,
    });
    expect(mockAddProxySignAndSubmit).toHaveBeenCalledWith(folderSigner);
  });

  test('addFolderMember maps read-only → Governance', async () => {
    const client = new AssetHubClient(mockChainConnection as any);
    const folderSigner = { publicKey: new Uint8Array(32) } as any;
    await client.addFolderMember('5GFolderAddr', '5GMemberAddr', 'read-only', folderSigner);
    expect(mockProxyAdd).toHaveBeenCalledWith({
      delegate: { type: 'Id', value: '5GMemberAddr' },
      proxy_type: 'Governance',
      delay: 0,
    });
  });

  test('removeFolderMember maps full → NonTransfer', async () => {
    const client = new AssetHubClient(mockChainConnection as any);
    const folderSigner = { publicKey: new Uint8Array(32) } as any;
    await client.removeFolderMember('5GFolderAddr', '5GMemberAddr', 'full', folderSigner);
    expect(mockProxyRemove).toHaveBeenCalledWith({
      delegate: { type: 'Id', value: '5GMemberAddr' },
      proxy_type: 'NonTransfer',
      delay: 0,
    });
    expect(mockRemoveProxySignAndSubmit).toHaveBeenCalledWith(folderSigner);
  });

  test('removeFolderMember maps read-only → Governance', async () => {
    const client = new AssetHubClient(mockChainConnection as any);
    const folderSigner = { publicKey: new Uint8Array(32) } as any;
    await client.removeFolderMember('5GFolderAddr', '5GMemberAddr', 'read-only', folderSigner);
    expect(mockProxyRemove).toHaveBeenCalledWith({
      delegate: { type: 'Id', value: '5GMemberAddr' },
      proxy_type: 'Governance',
      delay: 0,
    });
    expect(mockRemoveProxySignAndSubmit).toHaveBeenCalledWith(folderSigner);
  });

  test('getFolderMembers maps NonTransfer → full', async () => {
    mockProxiesGetValue.mockResolvedValue([
      [{ delegate: new Uint8Array(32).fill(3), proxy_type: { type: 'NonTransfer' }, delay: 0 }],
    ]);
    const client = new AssetHubClient(mockChainConnection as any);
    const members = await client.getFolderMembers('5GFolderAddr');
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe('full');
    expect(typeof members[0].masterAccount).toBe('string');
  });

  test('getFolderMembers maps Governance → read-only', async () => {
    mockProxiesGetValue.mockResolvedValue([
      [{ delegate: new Uint8Array(32).fill(4), proxy_type: { type: 'Governance' }, delay: 0 }],
    ]);
    const client = new AssetHubClient(mockChainConnection as any);
    const members = await client.getFolderMembers('5GFolderAddr');
    expect(members[0].role).toBe('read-only');
  });

  test('getFolderMembers returns empty array when no proxies', async () => {
    mockProxiesGetValue.mockResolvedValue([[]]);
    const client = new AssetHubClient(mockChainConnection as any);
    const members = await client.getFolderMembers('5GFolderAddr');
    expect(members).toHaveLength(0);
  });
});
