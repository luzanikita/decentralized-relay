import { blake2AsHex } from '@polkadot/util-crypto';
import { S3RN } from '../S3RN';
import type { IControlPlane, SessionParams } from './IControlPlane';

export class BulletinControlPlane implements IControlPlane {
  async getSession(resourceId: string): Promise<SessionParams> {
    const entity = S3RN.decode(resourceId) as any;
    let str: string;
    if (entity.documentId) {
      str = `${entity.folderId}:${entity.documentId}`;
    } else if (entity.canvasId) {
      str = `${entity.folderId}:${entity.canvasId}`;
    } else if (entity.folderId) {
      str = entity.folderId;
    } else {
      throw new Error(`BulletinControlPlane: cannot derive docId for ${resourceId}`);
    }
    const input = new TextEncoder().encode(str);
    return { docId: blake2AsHex(input, 256), authorization: 'full' };
  }

  destroy(): void {}
}
