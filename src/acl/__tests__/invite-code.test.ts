jest.mock('@polkadot/util-crypto', () => ({
  signatureVerify: jest.fn(),
  hexToU8a: jest.fn().mockImplementation((hex: string) => Buffer.from(hex, 'hex')),
  u8aToHex: jest.fn().mockImplementation((u8a: Uint8Array) => Buffer.from(u8a).toString('hex')),
}));

import { signatureVerify } from '@polkadot/util-crypto';
import { encodeInvite, decodeInvite, validateInvite, canonicalPayload, type InviteCode } from '../InviteCode';

const VALID_INVITE: InviteCode = {
  v: 1,
  folderId: 'folder-uuid-1234',
  folderAccountAddress: '5GFolderAccount',
  ownerMasterAccountId: '5GOwnerMaster',
  role: 'full',
  expiresAt: 0,
  sig: 'deadbeef',
};

describe('encodeInvite / decodeInvite round-trip', () => {
  test('decoded invite matches original', () => {
    const code = encodeInvite(VALID_INVITE);
    const decoded = decodeInvite(code);
    expect(decoded).toEqual(VALID_INVITE);
  });

  test('decodeInvite throws on malformed input', () => {
    expect(() => decodeInvite('not-valid-base64url!!')).toThrow();
  });
});

describe('canonicalPayload', () => {
  test('keys are sorted and sig is excluded', () => {
    const payload = canonicalPayload(VALID_INVITE);
    const parsed = JSON.parse(payload);
    expect('sig' in parsed).toBe(false);
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  test('same input always produces same canonical string', () => {
    expect(canonicalPayload(VALID_INVITE)).toBe(canonicalPayload({ ...VALID_INVITE }));
  });
});

describe('validateInvite', () => {
  beforeEach(() => jest.clearAllMocks());

  test('passes when signature is valid and not expired', () => {
    (signatureVerify as jest.Mock).mockReturnValue({ isValid: true });
    expect(() => validateInvite(VALID_INVITE)).not.toThrow();
    expect(signatureVerify).toHaveBeenCalledWith(
      canonicalPayload(VALID_INVITE),
      expect.any(Uint8Array),
      VALID_INVITE.ownerMasterAccountId,
    );
  });

  test('throws on bad signature', () => {
    (signatureVerify as jest.Mock).mockReturnValue({ isValid: false });
    expect(() => validateInvite(VALID_INVITE)).toThrow('Invalid invite signature');
  });

  test('throws when expiresAt is in the past', () => {
    (signatureVerify as jest.Mock).mockReturnValue({ isValid: true });
    const expired = { ...VALID_INVITE, expiresAt: Date.now() - 1000 };
    expect(() => validateInvite(expired)).toThrow('Invite code has expired');
  });

  test('does not throw when expiresAt is 0 (no expiry)', () => {
    (signatureVerify as jest.Mock).mockReturnValue({ isValid: true });
    expect(() => validateInvite({ ...VALID_INVITE, expiresAt: 0 })).not.toThrow();
  });
});
