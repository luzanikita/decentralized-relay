jest.mock('@polkadot/util-crypto', () => ({
  blake2AsHex: jest.fn().mockImplementation((data: Uint8Array) =>
    Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('')
  ),
}));

import { BulletinControlPlane } from '../BulletinControlPlane';
import { NotAuthorizedError } from '../IControlPlane';

const RELAY_ID  = '00000000-0000-0000-0000-000000000001';
const FOLDER_ID = '00000000-0000-0000-0000-000000000002';
const DOC_ID    = '00000000-0000-0000-0000-000000000003';
const DOC_ID2   = '00000000-0000-0000-0000-000000000004';
const CANVAS_ID = '00000000-0000-0000-0000-000000000005';

const remoteDocS3RN    = `s3rn:relay:relay:${RELAY_ID}:folder:${FOLDER_ID}:doc:${DOC_ID}`;
const remoteFolderS3RN = `s3rn:relay:relay:${RELAY_ID}:folder:${FOLDER_ID}`;
const remoteDoc2S3RN   = `s3rn:relay:relay:${RELAY_ID}:folder:${FOLDER_ID}:doc:${DOC_ID2}`;
const remoteCanvasS3RN = `s3rn:relay:relay:${RELAY_ID}:folder:${FOLDER_ID}:canvas:${CANVAS_ID}`;

const FOLDER_ACCOUNT = '5GFolderAccount';
const MY_MASTER      = '5GMyMaster';
const OTHER_MASTER   = '5GOtherMaster';

function makeMockAH(members: Array<{ masterAccount: string; role: 'full' | 'read-only' }> = []) {
  return { getFolderMembers: jest.fn().mockResolvedValue(members) };
}

describe('BulletinControlPlane — owner path (no folderAccountAddress)', () => {
  test('returns full authorization without calling asset hub', async () => {
    const ah = makeMockAH();
    const cp = new BulletinControlPlane(
      ah as any,
      () => MY_MASTER,
      () => null,
    );
    const params = await cp.getSession(remoteDocS3RN);
    expect(params.authorization).toBe('full');
    expect(ah.getFolderMembers).not.toHaveBeenCalled();
  });

  test('docId is deterministic', async () => {
    const cp = new BulletinControlPlane(makeMockAH() as any, () => MY_MASTER, () => null);
    const a = await cp.getSession(remoteDocS3RN);
    const b = await cp.getSession(remoteDocS3RN);
    expect(a.docId).toBe(b.docId);
  });

  test('different docs produce different docIds', async () => {
    const cp = new BulletinControlPlane(makeMockAH() as any, () => MY_MASTER, () => null);
    const a = await cp.getSession(remoteDocS3RN);
    const b = await cp.getSession(remoteDoc2S3RN);
    expect(a.docId).not.toBe(b.docId);
  });

  test('folder-only S3RN returns a docId', async () => {
    const cp = new BulletinControlPlane(makeMockAH() as any, () => MY_MASTER, () => null);
    const params = await cp.getSession(remoteFolderS3RN);
    expect(typeof params.docId).toBe('string');
    expect(params.docId.length).toBeGreaterThan(0);
  });

  test('canvas S3RN returns a docId', async () => {
    const cp = new BulletinControlPlane(makeMockAH() as any, () => MY_MASTER, () => null);
    const params = await cp.getSession(remoteCanvasS3RN);
    expect(typeof params.docId).toBe('string');
  });

  test('relayUrl and relayToken are absent', async () => {
    const cp = new BulletinControlPlane(makeMockAH() as any, () => MY_MASTER, () => null);
    const params = await cp.getSession(remoteDocS3RN);
    expect(params.relayUrl).toBeUndefined();
    expect(params.relayToken).toBeUndefined();
  });
});

describe('BulletinControlPlane — ACL path (folderAccountAddress set)', () => {
  test('returns full when caller is NonTransfer proxy (full member)', async () => {
    const ah = makeMockAH([{ masterAccount: MY_MASTER, role: 'full' }]);
    const cp = new BulletinControlPlane(
      ah as any,
      () => MY_MASTER,
      () => FOLDER_ACCOUNT,
    );
    const params = await cp.getSession(remoteDocS3RN);
    expect(params.authorization).toBe('full');
    expect(ah.getFolderMembers).toHaveBeenCalledWith(FOLDER_ACCOUNT);
  });

  test('returns read-only when caller is Governance proxy (read-only member)', async () => {
    const ah = makeMockAH([{ masterAccount: MY_MASTER, role: 'read-only' }]);
    const cp = new BulletinControlPlane(
      ah as any,
      () => MY_MASTER,
      () => FOLDER_ACCOUNT,
    );
    const params = await cp.getSession(remoteDocS3RN);
    expect(params.authorization).toBe('read-only');
  });

  test('throws NotAuthorizedError when caller is not in proxy list', async () => {
    const ah = makeMockAH([{ masterAccount: OTHER_MASTER, role: 'full' }]);
    const cp = new BulletinControlPlane(
      ah as any,
      () => MY_MASTER,
      () => FOLDER_ACCOUNT,
    );
    await expect(cp.getSession(remoteDocS3RN)).rejects.toThrow(NotAuthorizedError);
  });

  test('throws when myMasterAccountId is null', async () => {
    const cp = new BulletinControlPlane(
      makeMockAH() as any,
      () => null,
      () => FOLDER_ACCOUNT,
    );
    await expect(cp.getSession(remoteDocS3RN)).rejects.toThrow('No passkey identity configured');
  });
});

describe('BulletinControlPlane.destroy()', () => {
  test('does not throw', () => {
    const cp = new BulletinControlPlane(makeMockAH() as any, () => MY_MASTER, () => null);
    expect(() => cp.destroy()).not.toThrow();
  });
});
