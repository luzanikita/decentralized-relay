import { Keyring } from '@polkadot/keyring';
import { u8aToHex } from '@polkadot/util';
import { encodeAddress } from '@polkadot/util-crypto';
import { getPolkadotSigner } from '@polkadot-api/signer';
import type { PolkadotSigner } from 'polkadot-api';
import type { AssetHubClient } from '../asset-hub/AssetHubClient';
import { canonicalPayload, encodeInvite } from '../acl/InviteCode';
import type { InviteCode } from '../acl/InviteCode';
import type { ElectronSafeStorage, PasskeySettings } from './types';

const PRF_SALT = new TextEncoder().encode('decentralized-relay-sr25519-v1');
const MASTER_HKDF_INFO = new TextEncoder().encode('decentralized-relay-master-sr25519-v1');

function folderHkdfInfo(folderId: string): Uint8Array {
  return new TextEncoder().encode('decentralized-relay-folder-acl-v1:' + folderId);
}

export class PasskeyIdentity {
  constructor(
    private settings: PasskeySettings,
    private readonly saveSettings: (updated: PasskeySettings) => void,
    private readonly assetHubClient: AssetHubClient,
    private readonly safeStorage: ElectronSafeStorage,
    private readonly rpId: string = 'localhost',
  ) {
    if (!rpId) throw new Error('[PasskeyIdentity] rpId must be a non-empty string');
  }

  private _patch(patch: Partial<PasskeySettings>): void {
    Object.assign(this.settings, patch);
    this.saveSettings({ ...this.settings });
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
        authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
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
    if (!this.safeStorage || !this.safeStorage.isEncryptionAvailable()) {
      throw new Error('OS secure storage unavailable — passkey identity requires Electron safeStorage');
    }

    const deviceSeed = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const keyring = new Keyring({ type: 'sr25519' });
    const devicePair = keyring.addFromSeed(deviceSeed);

    // addProxy first: if encrypt/save fails after, the dangling proxy is recoverable; reversed order would store a key with no on-chain proxy
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
    if (!this.safeStorage) throw new Error('OS secure storage unavailable — cannot decrypt device key');
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

  private async _getMasterSeed(): Promise<Uint8Array> {
    if (!this.settings.credentialId) throw new Error('No passkey registered');
    const credentialId = Buffer.from(this.settings.credentialId, 'base64url');

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } } as any,
      },
    })) as PublicKeyCredential;

    if (!assertion) throw new Error('Passkey authentication was cancelled or no matching credential found');

    const ext = (assertion as any).getClientExtensionResults();
    const prfFirst = ext?.prf?.results?.first;
    if (!prfFirst) throw new Error('Authenticator did not return a PRF result — ensure the authenticator supports PRF at assertion time');

    return this._hkdf(new Uint8Array(prfFirst), MASTER_HKDF_INFO);
  }

  async getMasterSigner(): Promise<PolkadotSigner> {
    const masterSeed = await this._getMasterSeed();
    const keyring = new Keyring({ type: 'sr25519' });
    const masterPair = keyring.addFromSeed(masterSeed);
    return getPolkadotSigner(
      masterPair.publicKey,
      'Sr25519',
      (input: Uint8Array) => Promise.resolve(masterPair.sign(input)),
    );
  }

  async getFolderAccountSigner(folderId: string): Promise<PolkadotSigner> {
    const masterSeed = await this._getMasterSeed();
    const folderSeed = await this._hkdf(masterSeed, folderHkdfInfo(folderId));
    const keyring = new Keyring({ type: 'sr25519' });
    const folderPair = keyring.addFromSeed(folderSeed);
    return getPolkadotSigner(
      folderPair.publicKey,
      'Sr25519',
      (input: Uint8Array) => Promise.resolve(folderPair.sign(input)),
    );
  }

  async setupFolderAccount(folderId: string): Promise<string> {
    const signer = await this.getFolderAccountSigner(folderId);
    return encodeAddress(signer.publicKey);
  }

  async generateInvite(
    folderId: string,
    folderAccountAddress: string,
    role: 'full' | 'read-only',
    expiresInMs: number = 7 * 24 * 60 * 60 * 1000,
  ): Promise<string> {
    const masterSeed = await this._getMasterSeed();
    const keyring = new Keyring({ type: 'sr25519' });
    const masterPair = keyring.addFromSeed(masterSeed);

    const partial: Omit<InviteCode, 'sig'> = {
      v: 1,
      folderId,
      folderAccountAddress,
      ownerMasterAccountId: encodeAddress(masterPair.publicKey),
      role,
      expiresAt: expiresInMs > 0 ? Date.now() + expiresInMs : 0,
    };

    const payload = new TextEncoder().encode(canonicalPayload(partial));
    const sig = u8aToHex(masterPair.sign(payload));
    return encodeInvite({ ...partial, sig });
  }

  private async _hkdf(keyMaterial: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
    const k = await globalThis.crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, ['deriveBits']);
    const derived = await globalThis.crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info },
      k,
      256,
    );
    return new Uint8Array(derived);
  }
}
