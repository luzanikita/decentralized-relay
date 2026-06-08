import * as Y from 'yjs';
import { BulletinCheckpoint } from '../BulletinCheckpoint';
import type { BulletinClient } from '../BulletinClient';

function makeClient(overrides: Partial<Pick<BulletinClient, 'store' | 'fetch'>> = {}): BulletinClient {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue('bafyreiabc123'),
    fetch: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    destroy: jest.fn(),
    settings: {} as any,
    ...overrides,
  } as unknown as BulletinClient;
}

describe('BulletinCheckpoint', () => {
  let doc: Y.Doc;

  beforeEach(() => { doc = new Y.Doc(); });
  afterEach(() => { doc.destroy(); });

  test('checkpoint() encodes doc, calls client.store(), writes CID to _bulletin map', async () => {
    const client = makeClient();
    const cp = new BulletinCheckpoint(doc, client, 'doc-1');

    await cp.checkpoint();

    expect(client.store).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(doc.getMap('_bulletin').get('latestCid')).toBe('bafyreiabc123');
    cp.destroy();
  });

  test('update counter triggers checkpoint() at 50 updates', async () => {
    const client = makeClient();
    const cp = new BulletinCheckpoint(doc, client, 'doc-1');
    const spy = jest.spyOn(cp, 'checkpoint').mockResolvedValue(undefined);

    for (let i = 0; i < 49; i++) {
      doc.transact(() => { doc.getText('t').insert(0, 'x'); });
    }
    expect(spy).not.toHaveBeenCalled();

    doc.transact(() => { doc.getText('t').insert(0, 'y'); }); // 50th update
    await Promise.resolve(); // flush microtask queue
    expect(spy).toHaveBeenCalledTimes(1);
    cp.destroy();
  });

  test('self-update (origin === checkpoint instance) does not increment counter', async () => {
    const client = makeClient();
    const cp = new BulletinCheckpoint(doc, client, 'doc-1');
    const spy = jest.spyOn(cp, 'checkpoint').mockResolvedValue(undefined);

    // Fire 50 real updates to trigger once
    for (let i = 0; i < 50; i++) {
      doc.transact(() => { doc.getText('t').insert(0, 'x'); });
    }
    await Promise.resolve();
    const callsAfter50 = spy.mock.calls.length;

    // Self-update should NOT increment counter or re-trigger
    doc.transact(() => { doc.getMap('_bulletin').set('latestCid', 'noop'); }, cp);
    await Promise.resolve();
    expect(spy.mock.calls.length).toBe(callsAfter50);
    cp.destroy();
  });

  test('fetchAndApply() fetches the CID from _bulletin map and applies the snapshot', async () => {
    const remoteDoc = new Y.Doc();
    remoteDoc.getText('content').insert(0, 'remote content');
    const snapshot = Y.encodeStateAsUpdate(remoteDoc);
    remoteDoc.destroy();

    doc.getMap('_bulletin').set('latestCid', 'bafyreiabc123');
    const client = makeClient({ fetch: jest.fn().mockResolvedValue(snapshot) });

    const cp = new BulletinCheckpoint(doc, client, 'doc-1');
    await cp.fetchAndApply();

    expect(client.fetch).toHaveBeenCalledWith('bafyreiabc123');
    expect(doc.getText('content').toString()).toBe('remote content');
    cp.destroy();
  });

  test('fetchAndApply() returns early when no CID is stored', async () => {
    const client = makeClient();
    const cp = new BulletinCheckpoint(doc, client, 'doc-1');
    await cp.fetchAndApply();
    expect(client.fetch).not.toHaveBeenCalled();
    cp.destroy();
  });

  test('fetchAndApply() does not throw when fetch fails', async () => {
    doc.getMap('_bulletin').set('latestCid', 'bafyreiBAD');
    const client = makeClient({ fetch: jest.fn().mockRejectedValue(new Error('network error')) });

    const cp = new BulletinCheckpoint(doc, client, 'doc-1');
    await expect(cp.fetchAndApply()).resolves.not.toThrow();
    cp.destroy();
  });

  test('checkpoint() does not throw when store fails', async () => {
    const client = makeClient({ store: jest.fn().mockRejectedValue(new Error('chain error')) });
    const cp = new BulletinCheckpoint(doc, client, 'doc-1');
    await expect(cp.checkpoint()).resolves.not.toThrow();
    cp.destroy();
  });
});
