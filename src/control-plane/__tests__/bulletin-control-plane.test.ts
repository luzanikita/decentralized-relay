// Mock blake2AsHex to be deterministic based on actual input bytes.
// We don't need the real crypto; we just need determinism and collision-avoidance.
jest.mock('@polkadot/util-crypto', () => ({
  blake2AsHex: jest.fn().mockImplementation((data: Uint8Array) => {
    // deterministic fake hash: hex-encode the input
    return Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
  }),
}));

import { BulletinControlPlane } from '../BulletinControlPlane';

const RELAY_ID  = '00000000-0000-0000-0000-000000000001';
const FOLDER_ID = '00000000-0000-0000-0000-000000000002';
const DOC_ID    = '00000000-0000-0000-0000-000000000003';
const DOC_ID2   = '00000000-0000-0000-0000-000000000004';
const CANVAS_ID = '00000000-0000-0000-0000-000000000005';

const remoteDocS3RN = `s3rn:relay:relay:${RELAY_ID}:folder:${FOLDER_ID}:doc:${DOC_ID}`;
const remoteFolderS3RN = `s3rn:relay:relay:${RELAY_ID}:folder:${FOLDER_ID}`;
const remoteDoc2S3RN = `s3rn:relay:relay:${RELAY_ID}:folder:${FOLDER_ID}:doc:${DOC_ID2}`;
const remoteCanvasS3RN = `s3rn:relay:relay:${RELAY_ID}:folder:${FOLDER_ID}:canvas:${CANVAS_ID}`;

describe('BulletinControlPlane', () => {
  test('returns deterministic docId for the same document S3RN', async () => {
    const cp = new BulletinControlPlane();
    const a = await cp.getSession(remoteDocS3RN);
    const b = await cp.getSession(remoteDocS3RN);
    expect(a.docId).toBe(b.docId);
  });

  test('different documents produce different docIds', async () => {
    const cp = new BulletinControlPlane();
    const a = await cp.getSession(remoteDocS3RN);
    const b = await cp.getSession(remoteDoc2S3RN);
    expect(a.docId).not.toBe(b.docId);
  });

  test('folder-only S3RN produces a docId (no documentId)', async () => {
    const cp = new BulletinControlPlane();
    const params = await cp.getSession(remoteFolderS3RN);
    expect(typeof params.docId).toBe('string');
    expect(params.docId.length).toBeGreaterThan(0);
  });

  test('document and folder docIds differ for same folder', async () => {
    const cp = new BulletinControlPlane();
    const doc = await cp.getSession(remoteDocS3RN);
    const folder = await cp.getSession(remoteFolderS3RN);
    expect(doc.docId).not.toBe(folder.docId);
  });

  test('canvas S3RN produces a docId', async () => {
    const cp = new BulletinControlPlane();
    const params = await cp.getSession(remoteCanvasS3RN);
    expect(typeof params.docId).toBe('string');
    expect(params.docId.length).toBeGreaterThan(0);
  });

  test('authorization is always full', async () => {
    const cp = new BulletinControlPlane();
    const params = await cp.getSession(remoteDocS3RN);
    expect(params.authorization).toBe('full');
  });

  test('relayUrl and relayToken are absent', async () => {
    const cp = new BulletinControlPlane();
    const params = await cp.getSession(remoteDocS3RN);
    expect(params.relayUrl).toBeUndefined();
    expect(params.relayToken).toBeUndefined();
  });

  test('destroy() is a no-op and does not throw', () => {
    const cp = new BulletinControlPlane();
    expect(() => cp.destroy()).not.toThrow();
    expect(() => cp.destroy()).not.toThrow();
  });
});
