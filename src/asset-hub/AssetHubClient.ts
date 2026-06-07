import { encodeAddress } from '@polkadot/util-crypto';
import type { PolkadotSigner } from 'polkadot-api';
import { westend_asset_hub } from '../../.papi/descriptors/dist/index.js';
import type { ChainConnection } from '../chain/ChainConnection';
import type { ProxyEntry } from './types';

export class AssetHubClient {
  private _typedApi: any = null;

  constructor(private readonly connection: ChainConnection) {}

  async connect(): Promise<void> {
    if (this._typedApi) return;
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
    const [proxies] = result as [Array<{ delegate: Uint8Array; proxy_type: { type: string }; delay: number }>];
    return proxies.map((p) => ({
      delegate: encodeAddress(p.delegate),
      proxyType: p.proxy_type.type,
      delay: p.delay,
    }));
  }

  destroy(): void {
    this._typedApi = null;
    this.connection.destroy();
  }
}
