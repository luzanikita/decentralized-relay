export interface BulletinSettings {
  enabled: boolean;
  rpcUrl: string;
  ipfsGateway: string;
  signalingUrls: string[];
  signalingFallbackTimeoutMs: number;
  controlPlaneEnabled: boolean;
  assetHubRpcUrl: string;
  relayerUrl: string;
  subscriptionToken: string;
  lowBalanceThreshold: number; // planck units — safe as JS number for WND (10^12 per WND, max reasonable threshold < 10^15)
}

export const DEFAULT_BULLETIN_SETTINGS: BulletinSettings = {
  enabled: false,
  rpcUrl: '',
  ipfsGateway: 'https://ipfs.io/ipfs/',
  signalingUrls: ['wss://signaling.y-webrtc.com'],
  signalingFallbackTimeoutMs: 8000,
  controlPlaneEnabled: false,
  assetHubRpcUrl: 'wss://westend-asset-hub-rpc.polkadot.io',
  relayerUrl: '',
  subscriptionToken: '',
  lowBalanceThreshold: 1_000_000_000_000, // 1 WND in planck (12 decimals)
};
