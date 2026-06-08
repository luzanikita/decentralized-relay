import { blake2AsHex } from '@polkadot/util-crypto';
import { S3RN } from '../S3RN';
import type { AssetHubClient } from '../asset-hub/AssetHubClient';
import { NotAuthorizedError } from './IControlPlane';
import type { IControlPlane, SessionParams } from './IControlPlane';

export class BulletinControlPlane implements IControlPlane {
  constructor(
    private readonly assetHubClient: AssetHubClient,
    private readonly getMyMasterAccountId: () => string | null,
    private readonly getFolderAccountAddress: (folderId: string) => string | null,
  ) {}

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
    const docId = blake2AsHex(new TextEncoder().encode(str), 256);

    const folderId: string = entity.folderId;
    const folderAccountAddress = this.getFolderAccountAddress(folderId);

    if (!folderAccountAddress) {
      return { docId, authorization: 'full' };
    }

    const myMaster = this.getMyMasterAccountId();
    if (!myMaster) throw new Error('No passkey identity configured');

    const members = await this.assetHubClient.getFolderMembers(folderAccountAddress);
    const me = members.find((m) => m.masterAccount === myMaster);
    if (!me) throw new NotAuthorizedError(folderId);

    return { docId, authorization: me.role };
  }

  destroy(): void {}
}
