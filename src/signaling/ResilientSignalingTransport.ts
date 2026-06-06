import type { ISignalingTransport } from './ISignalingTransport';
import { PublicSignalingTransport } from './PublicSignalingTransport';
import { BulletinSignalingTransport } from './BulletinSignalingTransport';
import type { BulletinClient } from '../bulletin/BulletinClient';
import type { BulletinSettings } from '../bulletin/types';

export class ResilientSignalingTransport implements ISignalingTransport {
  private _primary: PublicSignalingTransport;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  readonly signalingUrls: string[];

  constructor(
    settings: Pick<BulletinSettings, 'signalingUrls' | 'signalingFallbackTimeoutMs'>,
    private readonly _bulletinClient: BulletinClient | null,
    private readonly _onFallback: (transport: BulletinSignalingTransport) => void,
  ) {
    this._primary = new PublicSignalingTransport(settings.signalingUrls);
    this.signalingUrls = this._primary.signalingUrls;

    if (settings.signalingFallbackTimeoutMs > 0 && _bulletinClient !== null) {
      this._timer = setTimeout(
        () => void this._triggerFallback(),
        settings.signalingFallbackTimeoutMs,
      );
    }
  }

  onPeerConnected(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private async _triggerFallback(): Promise<void> {
    if (this._destroyed || this._bulletinClient === null) return;
    this._primary.destroy();
    const bulletin = await BulletinSignalingTransport.create(this._bulletinClient);
    if (this._destroyed) {
      bulletin.destroy();
      return;
    }
    this._onFallback(bulletin);
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._primary.destroy();
  }
}
