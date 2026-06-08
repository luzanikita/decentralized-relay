// Mock electron safeStorage
jest.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: jest.fn().mockReturnValue(true),
    encryptString: jest.fn().mockImplementation((s: string) => Buffer.from('encrypted:' + s)),
    decryptString: jest.fn().mockImplementation((b: Buffer) => b.toString().replace('encrypted:', '')),
  },
}), { virtual: true });

jest.mock('@polkadot/keyring', () => ({
  Keyring: jest.fn().mockImplementation(() => ({
    addFromSeed: jest.fn().mockImplementation((seed: Uint8Array) => ({
      address: '5G' + Buffer.from(seed).toString('hex').slice(0, 10),
      publicKey: seed,
      sign: jest.fn().mockReturnValue(new Uint8Array(64)),
    })),
  })),
}));

jest.mock('@polkadot-api/signer', () => ({
  getPolkadotSigner: jest.fn().mockImplementation((publicKey: Uint8Array) => ({ publicKey })),
}));

jest.mock('@polkadot/util-crypto', () => ({
  encodeAddress: jest.fn().mockImplementation((bytes: Uint8Array) => '5G' + Buffer.from(bytes).toString('hex').slice(0, 10)),
}));

jest.mock('../../../.papi/descriptors/dist/index.js', () => ({ westend_asset_hub: {} }), { virtual: true });

import { PasskeyIdentity } from '../PasskeyIdentity';
import type { PasskeySettings } from '../types';

function makeSettings(overrides: Partial<PasskeySettings> = {}): PasskeySettings {
  return {
    credentialId: null,
    masterAccountId: null,
    deviceKeyEncrypted: null,
    deviceAccountId: null,
    ...overrides,
  };
}

const mockAssetHubClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  addProxy: jest.fn().mockResolvedValue(undefined),
  removeProxy: jest.fn().mockResolvedValue(undefined),
  getProxies: jest.fn().mockResolvedValue([]),
  destroy: jest.fn(),
};

const FAKE_CREDENTIAL_ID = Buffer.from('test-credential-id').toString('base64url');
const PRF_RESULT_FIRST = new Uint8Array(32).fill(42);

function makeCredentialsGet(prfFirst: Uint8Array = PRF_RESULT_FIRST) {
  return jest.fn().mockResolvedValue({
    getClientExtensionResults: () => ({
      prf: { results: { first: prfFirst.buffer } },
    }),
  });
}

function makeCredentialsCreate() {
  return jest.fn().mockResolvedValue({
    rawId: Buffer.from('test-credential-id'),
    getClientExtensionResults: () => ({ prf: { enabled: true } }),
  });
}

describe('PasskeyIdentity.register()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('stores credentialId after successful registration', async () => {
    global.navigator = { credentials: { create: makeCredentialsCreate(), get: jest.fn() } } as any;
    const settings = makeSettings();
    const save = jest.fn();
    const identity = new PasskeyIdentity(settings, save, mockAssetHubClient as any, require('electron').safeStorage);
    await identity.register();
    expect(settings.credentialId).toBe(FAKE_CREDENTIAL_ID);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ credentialId: FAKE_CREDENTIAL_ID }));
  });

  test('throws if authenticator does not support PRF', async () => {
    global.navigator = {
      credentials: {
        create: jest.fn().mockResolvedValue({
          rawId: Buffer.from('cred'),
          getClientExtensionResults: () => ({ prf: { enabled: false } }),
        }),
      },
    } as any;
    const identity = new PasskeyIdentity(makeSettings(), jest.fn(), mockAssetHubClient as any, require('electron').safeStorage);
    await expect(identity.register()).rejects.toThrow('PRF extension');
  });
});

describe('PasskeyIdentity.getMasterSigner()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('calls navigator.credentials.get with prf eval extension', async () => {
    const mockGet = makeCredentialsGet();
    global.navigator = { credentials: { get: mockGet } } as any;
    const settings = makeSettings({ credentialId: FAKE_CREDENTIAL_ID });
    const identity = new PasskeyIdentity(settings, jest.fn(), mockAssetHubClient as any, require('electron').safeStorage);
    await identity.getMasterSigner();
    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({
        publicKey: expect.objectContaining({
          userVerification: 'required',
          extensions: expect.objectContaining({ prf: expect.any(Object) }),
        }),
      }),
    );
  });

  test('PRF output → HKDF → deterministic master seed', async () => {
    global.navigator = { credentials: { get: makeCredentialsGet(PRF_RESULT_FIRST) } } as any;
    const settings = makeSettings({ credentialId: FAKE_CREDENTIAL_ID });
    const identity = new PasskeyIdentity(settings, jest.fn(), mockAssetHubClient as any, require('electron').safeStorage);
    const s1 = await identity.getMasterSigner();

    global.navigator = { credentials: { get: makeCredentialsGet(PRF_RESULT_FIRST) } } as any;
    const identity2 = new PasskeyIdentity({ ...settings }, jest.fn(), mockAssetHubClient as any, require('electron').safeStorage);
    const s2 = await identity2.getMasterSigner();

    expect(Buffer.from(s1.publicKey).toString('hex')).toBe(Buffer.from(s2.publicKey).toString('hex'));
  });

  test('different PRF outputs produce different master seeds', async () => {
    const prf1 = new Uint8Array(32).fill(1);
    const prf2 = new Uint8Array(32).fill(2);
    global.navigator = { credentials: { get: makeCredentialsGet(prf1) } } as any;
    const s1 = await new PasskeyIdentity(makeSettings({ credentialId: FAKE_CREDENTIAL_ID }), jest.fn(), mockAssetHubClient as any, require('electron').safeStorage).getMasterSigner();

    global.navigator = { credentials: { get: makeCredentialsGet(prf2) } } as any;
    const s2 = await new PasskeyIdentity(makeSettings({ credentialId: FAKE_CREDENTIAL_ID }), jest.fn(), mockAssetHubClient as any, require('electron').safeStorage).getMasterSigner();

    expect(Buffer.from(s1.publicKey).toString('hex')).not.toBe(Buffer.from(s2.publicKey).toString('hex'));
  });

  test('throws when no credentialId is set', async () => {
    const identity = new PasskeyIdentity(makeSettings(), jest.fn(), mockAssetHubClient as any, require('electron').safeStorage);
    await expect(identity.getMasterSigner()).rejects.toThrow('No passkey registered');
  });
});

describe('PasskeyIdentity.setupDeviceKey()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('encrypts and stores device seed, calls addProxy on Asset Hub', async () => {
    global.navigator = { credentials: { get: makeCredentialsGet() } } as any;
    const settings = makeSettings({ credentialId: FAKE_CREDENTIAL_ID });
    const save = jest.fn();
    const identity = new PasskeyIdentity(settings, save, mockAssetHubClient as any, require('electron').safeStorage);
    const masterSigner = { publicKey: new Uint8Array(32).fill(9) } as any;
    await identity.setupDeviceKey(masterSigner);
    expect(mockAssetHubClient.addProxy).toHaveBeenCalledTimes(1);
    expect(settings.deviceKeyEncrypted).not.toBeNull();
    expect(settings.deviceAccountId).not.toBeNull();
    expect(settings.masterAccountId).not.toBeNull();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ deviceKeyEncrypted: expect.any(String) }));
  });

  test('throws when safeStorage is unavailable', async () => {
    const { safeStorage } = require('electron');
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValueOnce(false);
    const identity = new PasskeyIdentity(makeSettings({ credentialId: FAKE_CREDENTIAL_ID }), jest.fn(), mockAssetHubClient as any, safeStorage);
    await expect(identity.setupDeviceKey({ publicKey: new Uint8Array(32) } as any)).rejects.toThrow('OS secure storage unavailable');
  });
});

describe('PasskeyIdentity.getDeviceSigner()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('round-trips device seed through safeStorage and returns signer', async () => {
    const { safeStorage } = require('electron');
    const seed = new Uint8Array(32).fill(77);
    const hex = Buffer.from(seed).toString('hex');
    const encrypted = Buffer.from('encrypted:' + hex).toString('base64');
    const settings = makeSettings({ deviceKeyEncrypted: encrypted, credentialId: FAKE_CREDENTIAL_ID });

    (safeStorage.decryptString as jest.Mock).mockReturnValueOnce(hex);
    const identity = new PasskeyIdentity(settings, jest.fn(), mockAssetHubClient as any, safeStorage);
    const signer = await identity.getDeviceSigner();
    expect(Buffer.from(signer.publicKey).toString('hex')).toBe(Buffer.from(seed).toString('hex'));
  });

  test('throws when no device key is stored', async () => {
    const identity = new PasskeyIdentity(makeSettings(), jest.fn(), mockAssetHubClient as any, require('electron').safeStorage);
    await expect(identity.getDeviceSigner()).rejects.toThrow('No device key');
  });
});
