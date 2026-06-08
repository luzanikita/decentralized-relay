import { encodeAddress } from '@polkadot/util-crypto';
import type { PolkadotSigner } from 'polkadot-api';
import { westend_asset_hub } from '../../.papi/descriptors/dist/index.js';
import type { ChainConnection } from '../chain/ChainConnection';
import type { FolderMember, ProxyEntry } from './types';

export class AssetHubClient {
  private _typedApi: any = null;
  private _connectPromise: Promise<void> | null = null;

  constructor(private readonly connection: ChainConnection) {}

  async connect(): Promise<void> {
    if (this._typedApi) return;
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._doConnect().catch((e) => {
      this._connectPromise = null;
      throw e;
    });
    return this._connectPromise;
  }

  private async _doConnect(): Promise<void> {
    await this.connection.connect();
    this._typedApi = this.connection.getClient().getTypedApi(westend_asset_hub);
  }

  async addProxy(deviceAddress: string, masterSigner: PolkadotSigner): Promise<void> {
    await this.connect();
    await this._typedApi.tx.Proxy.add_proxy({
      delegate: { type: 'Id', value: deviceAddress },
      proxy_type: 'NonTransfer',
      delay: 0,
    }).signAndSubmit(masterSigner);
  }

  async removeProxy(deviceAddress: string, masterSigner: PolkadotSigner): Promise<void> {
    await this.connect();
    await this._typedApi.tx.Proxy.remove_proxy({
      delegate: { type: 'Id', value: deviceAddress },
      proxy_type: 'NonTransfer',
      delay: 0,
    }).signAndSubmit(masterSigner);
  }

  async getProxies(masterAddress: string): Promise<ProxyEntry[]> {
    await this.connect();
    const result = await this._typedApi.query.Proxy.Proxies.getValue(masterAddress);
    const proxies: Array<{ delegate: Uint8Array; proxy_type: { type: string }; delay: number }> =
      Array.isArray(result?.[0]) ? result[0] : [];
    return proxies.map((p) => ({
      delegate: encodeAddress(p.delegate),
      proxyType: p.proxy_type.type,
      delay: p.delay,
    }));
  }

  async addFolderMember(
    folderAddress: string,
    memberMasterAddress: string,
    role: 'full' | 'read-only',
    folderSigner: PolkadotSigner,
  ): Promise<void> {
    await this.connect();
    // NonTransfer = full; Governance = read-only.
    // Governance is the narrowest universally-recognised type that has no useful
    // extrinsics on Asset Hub, so a read-only member holding it cannot drain the
    // folder account via Proxy.proxy even if they try. 'Any' must NOT be used here
    // because it grants unrestricted proxy execution rights.
    const proxy_type = role === 'full' ? 'NonTransfer' : 'Governance';
    await this._typedApi.tx.Proxy.add_proxy({
      delegate: { type: 'Id', value: memberMasterAddress },
      proxy_type,
      delay: 0,
    }).signAndSubmit(folderSigner);
  }

  async removeFolderMember(
    folderAddress: string,
    memberMasterAddress: string,
    role: 'full' | 'read-only',
    folderSigner: PolkadotSigner,
  ): Promise<void> {
    await this.connect();
    const proxy_type = role === 'full' ? 'NonTransfer' : 'Governance';
    await this._typedApi.tx.Proxy.remove_proxy({
      delegate: { type: 'Id', value: memberMasterAddress },
      proxy_type,
      delay: 0,
    }).signAndSubmit(folderSigner);
  }

  async getFolderMembers(folderAddress: string): Promise<FolderMember[]> {
    await this.connect();
    const result = await this._typedApi.query.Proxy.Proxies.getValue(folderAddress);
    const proxies: Array<{ delegate: Uint8Array; proxy_type: { type: string }; delay: number }> =
      Array.isArray(result?.[0]) ? result[0] : [];
    // Accept both Governance (current) and Any (briefly used during testnet; legacy compat).
    // On mainnet remove 'Any' from this filter once all Any proxies have been migrated.
    const FULL_TYPE = 'NonTransfer';
    const READONLY_TYPES = new Set(['Governance', 'Any']);
    return proxies
      .filter(p => p.proxy_type.type === FULL_TYPE || READONLY_TYPES.has(p.proxy_type.type))
      .map(p => ({
        masterAccount: encodeAddress(p.delegate),
        role: p.proxy_type.type === FULL_TYPE ? 'full' : 'read-only',
      }));
  }

  destroy(): void {
    this._typedApi = null;
    this._connectPromise = null;
    this.connection.destroy();
  }
}
