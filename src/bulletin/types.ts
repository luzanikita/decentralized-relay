export interface BulletinSettings {
  bulletinEnabled: boolean;
  bulletinRpcUrl: string;
  bulletinKeyfilePath: string;
  bulletinKeyfilePassword: string;
  bulletinIpfsGateway: string;
  /** WebSocket URLs for the primary public signaling path. */
  signalingUrls: string[];
  /**
   * Milliseconds before falling back to Bulletin Chain signaling.
   * 0 = disabled. Only active when bulletinEnabled is true.
   */
  signalingFallbackTimeoutMs: number;
}

export const DEFAULT_BULLETIN_SETTINGS: BulletinSettings = {
  bulletinEnabled: false,
  bulletinRpcUrl: '',
  bulletinKeyfilePath: '',
  bulletinKeyfilePassword: '',
  bulletinIpfsGateway: 'https://ipfs.io/ipfs/',
  signalingUrls: ['wss://signaling.y-webrtc.com'],
  signalingFallbackTimeoutMs: 8000,
};
