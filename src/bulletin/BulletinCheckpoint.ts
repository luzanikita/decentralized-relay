import * as Y from 'yjs';
import type { BulletinClient } from './BulletinClient';

const UPDATE_THRESHOLD = 50;
const BULLETIN_MAP = '_bulletin';
const LATEST_CID_KEY = 'latestCid';

export class BulletinCheckpoint {
  private _updateCount = 0;
  private readonly _onUpdate: (update: Uint8Array, origin: unknown) => void;

  constructor(
    private readonly _doc: Y.Doc,
    private readonly _client: BulletinClient,
    private readonly _docId: string,
  ) {
    this._onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      this._updateCount++;
      if (this._updateCount >= UPDATE_THRESHOLD) {
        this._updateCount = 0;
        void this.checkpoint();
      }
    };
    this._doc.on('update', this._onUpdate);
  }

  async fetchAndApply(): Promise<void> {
    const cid = this._doc.getMap(BULLETIN_MAP).get(LATEST_CID_KEY) as string | undefined;
    if (!cid) return;
    try {
      const snapshot = await this._client.fetch(cid);
      Y.applyUpdate(this._doc, snapshot);
    } catch (e) {
      console.warn(`[BulletinCheckpoint] fetchAndApply failed for ${this._docId}:`, e);
    }
  }

  async checkpoint(): Promise<void> {
    try {
      const snapshot = Y.encodeStateAsUpdate(this._doc);
      const cid = await this._client.store(snapshot);
      this._doc.transact(() => {
        this._doc.getMap(BULLETIN_MAP).set(LATEST_CID_KEY, cid);
      }, this);
    } catch (e) {
      console.error(`[BulletinCheckpoint] checkpoint failed for ${this._docId}:`, e);
    }
  }

  destroy(): void {
    this._doc.off('update', this._onUpdate);
  }
}
