import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, blake2AsU8a } from '@polkadot/util-crypto';
import { getPolkadotSigner } from '@polkadot-api/signer';
import { CID } from 'multiformats/cid';
import * as multihash from 'multiformats/hashes/digest';
import { readFileSync } from 'fs';
import { bulletin } from '../../.papi/descriptors/dist/index.js';
import type { BulletinSettings } from './types';

const RAW_CODEC = 0x55;
const BLAKE2B_256 = 0xb220;

type State = 'idle' | 'connecting' | 'connected' | 'failed';

export class BulletinClient {
  private _state: State = 'idle';
  private _papiClient: ReturnType<typeof createClient> | null = null;
  private _typedApi: any = null;
  private _signer: any = null;
  private _connectPromise: Promise<void> | null = null;
  private _accountId: string | null = null;

  constructor(readonly settings: BulletinSettings) {}

  async connect(): Promise<void> {
    if (this._state === 'connected') return;
    if (this._state === 'failed') throw new Error('[BulletinClient] Connection previously failed; destroy and recreate the client');
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._doConnect();
    return this._connectPromise;
  }

  private async _doConnect(): Promise<void> {
    this._state = 'connecting';
    try {
      await cryptoWaitReady();
      const keyfileJson = JSON.parse(
        readFileSync(this.settings.bulletinKeyfilePath, 'utf-8'),
      );
      const keyring = new Keyring({ type: 'sr25519' });
      const pair = keyring.addFromJson(keyfileJson);
      (pair as any).decipher(this.settings.bulletinKeyfilePassword);
      this._accountId = pair.address;

      this._signer = getPolkadotSigner(
        pair.publicKey,
        'Sr25519',
        (input: Uint8Array) => Promise.resolve(pair.sign(input)),
      );
      this._papiClient = createClient(getWsProvider(this.settings.bulletinRpcUrl));
      this._typedApi = this._papiClient.getTypedApi(bulletin);
      this._state = 'connected';
    } catch (e) {
      this._state = 'failed';
      console.error('[BulletinClient] connect failed:', e);
    }
  }

  async store(data: Uint8Array): Promise<string> {
    await this.connect();
    if (this._state !== 'connected') {
      throw new Error('[BulletinClient] store() called but client is not connected');
    }
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
    // (a) Validate CID format — rejects arbitrary peer-supplied strings
    const parsed = CID.parse(cid);
    // (c) URL-encode the CID segment so it cannot rewrite the request path
    const url = `${this.settings.bulletinIpfsGateway}${encodeURIComponent(cid)}`;
    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw new Error(`IPFS fetch failed: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // (b) Verify content integrity: recompute hash and compare to CID's multihash
    if (parsed.multihash.code === BLAKE2B_256) {
      const actualHash = blake2AsU8a(bytes, 256);
      const expectedHash = parsed.multihash.digest;
      if (actualHash.length !== expectedHash.length || !actualHash.every((b, i) => b === expectedHash[i])) {
        throw new Error(`[BulletinClient] content integrity check failed for CID ${cid}`);
      }
    }
    return bytes;
  }

  get accountId(): string {
    if (!this._accountId) throw new Error('[BulletinClient] Not connected');
    return this._accountId;
  }

  subscribeToStoredCids(cb: (cid: string) => void): () => void {
    const sub = (this._papiClient as any).bestBlocks$.subscribe(
      async (blocks: Array<{ hash: string }>) => {
        const block = blocks[0];
        if (!block) return;
        try {
          const events: any[] = await this._typedApi.query.System.Events.getValue({
            at: block.hash,
          });
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
    if (this._papiClient) {
      this._papiClient.destroy();
      this._papiClient = null;
    }
    this._typedApi = null;
    this._signer = null;
    this._state = 'idle';
    this._connectPromise = null;
    this._accountId = null;
  }
}
