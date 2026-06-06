import type { ISignalingTransport } from './ISignalingTransport';

const DEFAULT_URLS = ['wss://signaling.y-webrtc.com'];

export class PublicSignalingTransport implements ISignalingTransport {
  readonly signalingUrls: string[];

  constructor(urls: string[] = DEFAULT_URLS) {
    this.signalingUrls = urls;
  }

  destroy(): void {
    // no-op
  }
}
