export interface PasskeySettings {
  credentialId: string | null;
  masterAccountId: string | null;
  deviceKeyEncrypted: string | null;
  deviceAccountId: string | null;
}

export const DEFAULT_PASSKEY_SETTINGS: PasskeySettings = {
  credentialId: null,
  masterAccountId: null,
  deviceKeyEncrypted: null,
  deviceAccountId: null,
};

export interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}
