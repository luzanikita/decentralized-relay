export interface BulletinSettings {
  bulletinEnabled: boolean;
  bulletinRpcUrl: string;
  bulletinKeyfilePath: string;
  bulletinKeyfilePassword: string;
  bulletinIpfsGateway: string;
}

export const DEFAULT_BULLETIN_SETTINGS: BulletinSettings = {
  bulletinEnabled: false,
  bulletinRpcUrl: '',
  bulletinKeyfilePath: '',
  bulletinKeyfilePassword: '',
  bulletinIpfsGateway: 'https://ipfs.io/ipfs/',
};
