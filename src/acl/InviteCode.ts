import { signatureVerify, hexToU8a } from '@polkadot/util-crypto';

export interface InviteCode {
  v: 1;
  folderId: string;
  folderAccountAddress: string;
  ownerMasterAccountId: string;
  role: 'full' | 'read-only';
  expiresAt: number;  // Unix ms; 0 = no expiry
  sig: string;        // hex sr25519 sig over canonicalPayload
}

export function canonicalPayload(invite: Omit<InviteCode, 'sig'>): string {
  const keys = (Object.keys(invite) as Array<keyof typeof invite>)
    .filter((k) => k !== 'sig')
    .sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) obj[k] = invite[k];
  return JSON.stringify(obj);
}

export function encodeInvite(invite: InviteCode): string {
  return Buffer.from(JSON.stringify(invite)).toString('base64url');
}

export function decodeInvite(code: string): InviteCode {
  return JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as InviteCode;
}

export function validateInvite(invite: InviteCode): void {
  if (invite.expiresAt !== 0 && Date.now() > invite.expiresAt) {
    throw new Error('Invite code has expired');
  }
  const payload = canonicalPayload(invite);
  const result = signatureVerify(payload, hexToU8a(invite.sig), invite.ownerMasterAccountId);
  if (!result.isValid) {
    throw new Error('Invalid invite signature');
  }
}
