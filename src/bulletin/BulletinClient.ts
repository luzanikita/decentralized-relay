import { CID } from 'multiformats/cid';
import * as multihash from 'multiformats/hashes/digest';
import { blake2AsU8a } from '@polkadot/util-crypto';
import { encodeAddress } from '@polkadot/util-crypto';
import type { PolkadotSigner } from 'polkadot-api';
import { bulletin } from '../../.papi/descriptors/dist/index.js';
import type { ChainConnection } from '../chain/ChainConnection';

const RAW_CODEC = 0x55;
const BLAKE2B_256 = 0xb220;

export class BulletinClient {
  private _typedApi: any = null;
  private _signer: PolkadotSigner | null = null;
  private _connectPromise: Promise<void> | null = null;

  constructor(
    private readonly connection: ChainConnection,
    private readonly signerFactory: () => Promise<PolkadotSigner>,
    private readonly ipfsGateway: string,
  ) {}

  async connect(): Promise<void> {
    if (this._typedApi) return;
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._doConnect();
    return this._connectPromise;
  }

  private async _doConnect(): Promise<void> {
    await this.connection.connect();
    this._typedApi = this.connection.getClient().getTypedApi(bulletin);
    this._signer = await this.signerFactory();
  }

  async store(data: Uint8Array): Promise<string> {
    await this.connect();
    if (!this._typedApi) throw new Error('[BulletinClient] store() called but client is not connected');
    const cid = await this._computeCid(data);
    await this._submitStore(data);
    return cid;
  }

  private async _computeCid(data: Uint8Array): Promise<string> {
    const hash = blake2AsU8a(data, 256);
    const mh = multihash.create(BLAKE2B_256, hash);
    return CID.createV1(RAW_CODEC, mh).toString();
  }

  private _submitStore(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let sub: { unsubscribe: () => void } | null = null;
      const observable = this._typedApi.tx.TransactionStorage.store({ data })
        .signSubmitAndWatch(this._signer);
      sub = observable.subscribe({
        next: (ev: any) => {
          if (!settled && ev.type === 'txBestBlocksState' && ev.found) {
            settled = true;
            if (sub) sub.unsubscribe();
            resolve();
          }
        },
        error: (err: Error) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        },
      });
    });
  }

  async fetch(cid: string): Promise<Uint8Array> {
    const parsed = CID.parse(cid);
    const url = `${this.ipfsGateway}${encodeURIComponent(cid)}`;
    const response = await globalThis.fetch(url);
    if (!response.ok) throw new Error(`IPFS fetch failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (parsed.multihash.code === BLAKE2B_256) {
      const actualHash = blake2AsU8a(bytes, 256);
      const expectedHash = parsed.multihash.digest;
      if (
        actualHash.length !== expectedHash.length ||
        !actualHash.every((b, i) => b === expectedHash[i])
      ) {
        throw new Error(`[BulletinClient] content integrity check failed for CID ${cid}`);
      }
    }
    return bytes;
  }

  get accountId(): string {
    if (!this._signer) throw new Error('[BulletinClient] Not connected');
    return encodeAddress(this._signer.publicKey);
  }

  subscribeToStoredCids(cb: (cid: string) => void): () => void {
    const client = this.connection.getClient() as any;
    const sub = client.bestBlocks$.subscribe(
      async (blocks: Array<{ hash: string }>) => {
        const block = blocks[0];
        if (!block) return;
        try {
          const events: any[] = await this._typedApi.query.System.Events.getValue({ at: block.hash });
          for (const record of events) {
            const ev = record?.event;
            if (ev?.type === 'TransactionStorage' && ev?.value?.type === 'Stored') {
              cb(ev.value.value.cid as string);
            }
          }
        } catch {
          // non-fatal: skip block if events cannot be read
        }
      },
    );
    return () => sub.unsubscribe();
  }

  destroy(): void {
    this._typedApi = null;
    this._signer = null;
    this._connectPromise = null;
    this.connection.destroy();
  }
}
