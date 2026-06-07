import { Keyring } from '@polkadot/keyring';
import { encodeAddress } from '@polkadot/util-crypto';
import { getPolkadotSigner } from '@polkadot-api/signer';
import type { PolkadotSigner } from 'polkadot-api';
import type { AssetHubClient } from '../asset-hub/AssetHubClient';
import type { ElectronSafeStorage, PasskeySettings } from './types';

const PRF_SALT = new TextEncoder().encode('decentralized-relay-sr25519-v1');
const HKDF_INFO = new TextEncoder().encode('decentralized-relay-master-sr25519-v1');

export class PasskeyIdentity {
  constructor(
    private settings: PasskeySettings,
    private readonly saveSettings: (updated: PasskeySettings) => void,
    private readonly assetHubClient: AssetHubClient,
    private readonly safeStorage: ElectronSafeStorage,
    private readonly rpId: string = 'localhost',
  ) {}

  private _patch(patch: Partial<PasskeySettings>): void {
    Object.assign(this.settings, patch);
    this.saveSettings(this.settings);
  }

  async register(): Promise<void> {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        rp: { id: this.rpId, name: 'Decentralized Relay' },
        user: {
          id: globalThis.crypto.getRandomValues(new Uint8Array(16)),
          name: 'relay-user',
          displayName: 'Relay User',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        extensions: { prf: {} } as any,
      },
    })) as PublicKeyCredential;

    const ext = (credential as any).getClientExtensionResults();
    if (!ext?.prf?.enabled) {
      throw new Error('Passkey does not support the PRF extension — use a FIDO2 authenticator with PRF support');
    }

    const credentialId = Buffer.from(credential.rawId).toString('base64url');
    this._patch({ credentialId });
  }

  async setupDeviceKey(masterSigner: PolkadotSigner): Promise<void> {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('OS secure storage unavailable — passkey identity requires Electron safeStorage');
    }

    const deviceSeed = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const keyring = new Keyring({ type: 'sr25519' });
    const devicePair = keyring.addFromSeed(deviceSeed);

    await this.assetHubClient.addProxy(devicePair.address, masterSigner);

    const encrypted = this.safeStorage.encryptString(Buffer.from(deviceSeed).toString('hex'));
    this._patch({
      deviceKeyEncrypted: Buffer.from(encrypted).toString('base64'),
      deviceAccountId: devicePair.address,
      masterAccountId: encodeAddress(masterSigner.publicKey),
    });
  }

  async getDeviceSigner(): Promise<PolkadotSigner> {
    if (!this.settings.deviceKeyEncrypted) throw new Error('No device key configured');
    const encrypted = Buffer.from(this.settings.deviceKeyEncrypted, 'base64');
    const hex = this.safeStorage.decryptString(encrypted);
    const deviceSeed = Buffer.from(hex, 'hex');
    const keyring = new Keyring({ type: 'sr25519' });
    const pair = keyring.addFromSeed(deviceSeed);
    return getPolkadotSigner(
      pair.publicKey,
      'Sr25519',
      (input: Uint8Array) => Promise.resolve(pair.sign(input)),
    );
  }

  async getMasterSigner(): Promise<PolkadotSigner> {
    if (!this.settings.credentialId) throw new Error('No passkey registered');
    const credentialId = Buffer.from(this.settings.credentialId, 'base64url');

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        extensions: { prf: { eval: { first: PRF_SALT } } } as any,
      },
    })) as PublicKeyCredential;

    const ext = (assertion as any).getClientExtensionResults();
    const prf32 = new Uint8Array(ext.prf.results.first);
    const masterSeed = await this._hkdf(prf32);

    const keyring = new Keyring({ type: 'sr25519' });
    const masterPair = keyring.addFromSeed(masterSeed);
    return getPolkadotSigner(
      masterPair.publicKey,
      'Sr25519',
      (input: Uint8Array) => Promise.resolve(masterPair.sign(input)),
    );
  }

  private async _hkdf(prf32: Uint8Array): Promise<Uint8Array> {
    const keyMaterial = await globalThis.crypto.subtle.importKey('raw', prf32, 'HKDF', false, ['deriveBits']);
    const derived = await globalThis.crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
      keyMaterial,
      256,
    );
    return new Uint8Array(derived);
  }
}
