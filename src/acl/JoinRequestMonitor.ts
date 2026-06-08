import type { BulletinClient } from '../bulletin/BulletinClient';
import { decodeInvite, validateInvite } from './InviteCode';

export interface JoinRequest {
  type: 'join-request';
  folderId: string;
  folderAccountAddress: string;
  requesterMaster: string;
  invite: string;
}

function isJoinRequest(obj: unknown): obj is JoinRequest {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return (
    r.type === 'join-request' &&
    typeof r.folderId === 'string' &&
    typeof r.folderAccountAddress === 'string' &&
    typeof r.requesterMaster === 'string' &&
    typeof r.invite === 'string'
  );
}

export class JoinRequestMonitor {
  private _unsubscribe: (() => void) | null = null;

  constructor(
    private readonly bulletinClient: BulletinClient,
    private readonly knownFolders: () => Map<string, string>,
    private readonly onRequest: (req: JoinRequest) => void,
  ) {}

  start(): void {
    if (this._unsubscribe) return;
    this._unsubscribe = this.bulletinClient.subscribeToStoredCids((cid) => {
      this._handleCid(cid).catch(() => {});
    });
  }

  stop(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  private async _handleCid(cid: string): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await this.bulletinClient.fetch(cid);
    } catch {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return;
    }

    if (!isJoinRequest(payload)) return;

    const folders = this.knownFolders();
    const expectedAddr = folders.get(payload.folderId);
    if (!expectedAddr || expectedAddr !== payload.folderAccountAddress) return;

    try {
      const invite = decodeInvite(payload.invite);
      validateInvite(invite);
    } catch {
      return;
    }

    this.onRequest(payload);
  }
}
