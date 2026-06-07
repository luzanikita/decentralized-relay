import { createClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws';
import { cryptoWaitReady } from '@polkadot/util-crypto';

type State = 'idle' | 'connecting' | 'connected' | 'failed';

export class ChainConnection {
  private _client: ReturnType<typeof createClient> | null = null;
  private _state: State = 'idle';
  private _connectPromise: Promise<void> | null = null;

  constructor(private readonly wsUrl: string) {}

  async connect(): Promise<void> {
    if (this._state === 'connected') return;
    if (this._state === 'failed') throw new Error('[ChainConnection] Connection previously failed; destroy and recreate');
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._doConnect();
    return this._connectPromise;
  }

  private async _doConnect(): Promise<void> {
    this._state = 'connecting';
    try {
      await cryptoWaitReady();
      this._client = createClient(getWsProvider(this.wsUrl));
      this._state = 'connected';
    } catch (e) {
      this._state = 'failed';
      this._connectPromise = null;
      throw e;
    }
  }

  getClient(): ReturnType<typeof createClient> {
    if (!this._client) throw new Error('[ChainConnection] Not connected');
    return this._client;
  }

  get state(): State {
    return this._state;
  }

  destroy(): void {
    if (this._client) {
      this._client.destroy();
      this._client = null;
    }
    this._state = 'idle';
    this._connectPromise = null;
  }
}
