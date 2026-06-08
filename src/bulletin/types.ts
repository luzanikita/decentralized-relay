export interface BulletinSettings {
  enabled: boolean;
  rpcUrl: string;
  ipfsGateway: string;
  signalingUrls: string[];
  signalingFallbackTimeoutMs: number;
  controlPlaneEnabled: boolean;
  assetHubRpcUrl: string;
}

export const DEFAULT_BULLETIN_SETTINGS: BulletinSettings = {
  enabled: false,
  rpcUrl: '',
  ipfsGateway: 'https://ipfs.io/ipfs/',
  signalingUrls: ['wss://signaling.y-webrtc.com'],
  signalingFallbackTimeoutMs: 8000,
  controlPlaneEnabled: false,
  assetHubRpcUrl: 'wss://westend-asset-hub-rpc.polkadot.io',
};
