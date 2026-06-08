jest.mock('../../acl/InviteCode', () => ({
  decodeInvite: jest.fn(),
  validateInvite: jest.fn(),
}));

import { decodeInvite, validateInvite } from '../InviteCode';
import { JoinRequestMonitor, type JoinRequest } from '../JoinRequestMonitor';

const FOLDER_ID   = 'folder-uuid-1234';
const FOLDER_ADDR = '5GFolderAccount';
const BOB_MASTER  = '5GBobMaster';
const INVITE_CODE = 'base64url-invite-code';

const VALID_REQUEST: JoinRequest = {
  type: 'join-request',
  folderId: FOLDER_ID,
  folderAccountAddress: FOLDER_ADDR,
  requesterMaster: BOB_MASTER,
  invite: INVITE_CODE,
};

function makeStoredCid(payload: object | null): { subscribe: (cb: (cid: string) => void) => () => void } {
  let cb: ((cid: string) => void) | null = null;
  const unsubscribe = jest.fn();
  return {
    _fire: (cid: string) => cb?.(cid),
    subscribe: jest.fn().mockImplementation((fn: (cid: string) => void) => { cb = fn; return unsubscribe; }),
    unsubscribe,
    _payload: payload,
  } as any;
}

function makeBulletinClient(payload: object | null = VALID_REQUEST) {
  const stub = makeStoredCid(payload);
  return {
    subscribeToStoredCids: stub.subscribe,
    fetch: jest.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(payload))),
    _fire: stub._fire.bind(stub),
    _unsubscribe: stub.unsubscribe,
  };
}

describe('JoinRequestMonitor', () => {
  beforeEach(() => jest.clearAllMocks());

  test('fires onRequest for a valid join request matching a known folder', async () => {
    const onRequest = jest.fn();
    const bc = makeBulletinClient();
    (decodeInvite as jest.Mock).mockReturnValue({ ownerMasterAccountId: '5GOwner' });
    (validateInvite as jest.Mock).mockReturnValue(undefined);
    const monitor = new JoinRequestMonitor(
      bc as any,
      () => new Map([[FOLDER_ID, FOLDER_ADDR]]),
      onRequest,
    );
    monitor.start();
    bc._fire('some-cid');
    await new Promise(r => setTimeout(r, 0));
    expect(onRequest).toHaveBeenCalledWith(VALID_REQUEST);
  });

  test('skips payload that is not a join-request shape', async () => {
    const onRequest = jest.fn();
    const bc = makeBulletinClient({ type: 'snapshot', data: 'abc' });
    const monitor = new JoinRequestMonitor(bc as any, () => new Map(), onRequest);
    monitor.start();
    bc._fire('cid-x');
    await new Promise(r => setTimeout(r, 0));
    expect(onRequest).not.toHaveBeenCalled();
  });

  test('skips request whose folderAccountAddress is not in knownFolders', async () => {
    const onRequest = jest.fn();
    const bc = makeBulletinClient();
    const monitor = new JoinRequestMonitor(bc as any, () => new Map(), onRequest);
    monitor.start();
    bc._fire('cid-y');
    await new Promise(r => setTimeout(r, 0));
    expect(onRequest).not.toHaveBeenCalled();
  });

  test('skips request with invalid invite signature', async () => {
    const onRequest = jest.fn();
    const bc = makeBulletinClient();
    (decodeInvite as jest.Mock).mockReturnValue({});
    (validateInvite as jest.Mock).mockImplementation(() => { throw new Error('Invalid invite signature'); });
    const monitor = new JoinRequestMonitor(
      bc as any,
      () => new Map([[FOLDER_ID, FOLDER_ADDR]]),
      onRequest,
    );
    monitor.start();
    bc._fire('cid-z');
    await new Promise(r => setTimeout(r, 0));
    expect(onRequest).not.toHaveBeenCalled();
  });

  test('stop() unsubscribes from Bulletin Chain', () => {
    const bc = makeBulletinClient();
    const monitor = new JoinRequestMonitor(bc as any, () => new Map(), jest.fn());
    monitor.start();
    monitor.stop();
    expect(bc._unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('start() is idempotent — does not double-subscribe', () => {
    const bc = makeBulletinClient();
    const monitor = new JoinRequestMonitor(bc as any, () => new Map(), jest.fn());
    monitor.start();
    monitor.start();
    expect(bc.subscribeToStoredCids).toHaveBeenCalledTimes(1);
  });
});
