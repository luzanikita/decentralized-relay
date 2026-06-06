import { EventEmitter } from 'events';
import * as Y from 'yjs';

// --- mock y-webrtc before importing WebRTCProvider ---
const mockInner = {
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  destroy: jest.fn(),
  awareness: {
    setLocalStateField: jest.fn(),
    getStates: jest.fn(() => new Map()),
  },
  connected: false,
  shouldConnect: false,
  _emitter: new EventEmitter(),
};

// Store listener registrations so tests can trigger inner events
mockInner.on.mockImplementation((event: string, cb: (...args: any[]) => void) => {
  mockInner._emitter.on(event, cb);
});
mockInner.off.mockImplementation((event: string, cb: (...args: any[]) => void) => {
  mockInner._emitter.off(event, cb);
});

jest.mock('y-webrtc', () => ({
  WebrtcProvider: jest.fn(() => mockInner),
}));

import { WebrtcProvider as MockWebrtcProvider } from 'y-webrtc';
import { WebRTCProvider } from '../webrtc-provider';

beforeEach(() => {
  jest.clearAllMocks();
  mockInner.connected = false;
  mockInner.shouldConnect = false;
  mockInner._emitter.removeAllListeners();
  mockInner.on.mockImplementation((event: string, cb: (...args: any[]) => void) => {
    mockInner._emitter.on(event, cb);
  });
  mockInner.off.mockImplementation((event: string, cb: (...args: any[]) => void) => {
    mockInner._emitter.off(event, cb);
  });
});

describe('WebRTCProvider constructor', () => {
  it('creates inner WebrtcProvider with docId as room name', () => {
    const doc = new Y.Doc();
    new WebRTCProvider('doc-abc-123', doc);
    expect(MockWebrtcProvider).toHaveBeenCalledWith(
      'doc-abc-123',
      doc,
      expect.objectContaining({ signaling: expect.any(Array) }),
    );
  });

  it('uses default signaling URL when no options provided', () => {
    const doc = new Y.Doc();
    new WebRTCProvider('doc-abc-123', doc);
    expect(MockWebrtcProvider).toHaveBeenCalledWith(
      'doc-abc-123',
      doc,
      expect.objectContaining({ signaling: ['wss://signaling.y-webrtc.com'] }),
    );
  });

  it('uses URLs from a provided ISignalingTransport', () => {
    const doc = new Y.Doc();
    const transport = { signalingUrls: ['wss://custom.example.com'], destroy: jest.fn() };
    new WebRTCProvider('doc-abc-123', doc, undefined, { transport });
    expect(MockWebrtcProvider).toHaveBeenCalledWith(
      'doc-abc-123',
      doc,
      expect.objectContaining({ signaling: ['wss://custom.example.com'] }),
    );
  });
});

describe('WebRTCProvider transport.onPeerConnected', () => {
  it('calls transport.onPeerConnected() when synced fires true', () => {
    const doc = new Y.Doc();
    const transport = {
      signalingUrls: ['wss://a.example.com'],
      destroy: jest.fn(),
      onPeerConnected: jest.fn(),
    };
    new WebRTCProvider('room', doc, undefined, { transport });

    mockInner._emitter.emit('synced', { synced: true });

    expect(transport.onPeerConnected).toHaveBeenCalledTimes(1);
  });

  it('does not throw when transport has no onPeerConnected', () => {
    const doc = new Y.Doc();
    const transport = { signalingUrls: ['wss://a.example.com'], destroy: jest.fn() };
    new WebRTCProvider('room', doc, undefined, { transport });
    expect(() => mockInner._emitter.emit('synced', { synced: true })).not.toThrow();
  });
});

describe('WebRTCProvider delegation', () => {
  it('connect sets shouldConnect and calls inner.connect', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    provider.connect();
    expect(mockInner.connect).toHaveBeenCalledTimes(1);
  });

  it('disconnect calls inner.disconnect', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    provider.disconnect();
    expect(mockInner.disconnect).toHaveBeenCalledTimes(1);
  });

  it('destroy calls inner.destroy', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    provider.destroy();
    expect(mockInner.destroy).toHaveBeenCalledTimes(1);
  });

  it('awareness passes through inner.awareness', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.awareness).toBe(mockInner.awareness);
  });
});

describe('WebRTCProvider event mapping', () => {
  it("inner 'status' {connected:true} emits 'status' with status:connected, intent:connected", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    const handler = jest.fn();
    provider.on('status', handler);

    mockInner.connected = true;
    mockInner.shouldConnect = true;
    mockInner._emitter.emit('status', { connected: true });

    expect(handler).toHaveBeenCalledWith({ status: 'connected', intent: 'connected' });
  });

  it("inner 'status' {connected:false} emits 'status' with status:disconnected", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    const statusHandler = jest.fn();
    provider.on('status', statusHandler);

    mockInner.connected = false;
    mockInner.shouldConnect = true;
    mockInner._emitter.emit('status', { connected: false });

    expect(statusHandler).toHaveBeenCalledWith({ status: 'disconnected', intent: 'connected' });
  });

  it("inner 'status' {connected:false} also emits 'connection-close'", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    const closeHandler = jest.fn();
    provider.on('connection-close', closeHandler);

    mockInner._emitter.emit('status', { connected: false });

    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  it("inner 'synced' true sets synced flag and emits 'synced' true", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    const syncHandler = jest.fn();
    provider.on('synced', syncHandler);

    expect(provider.synced).toBe(false);
    mockInner._emitter.emit('synced', { synced: true });

    expect(provider.synced).toBe(true);
    expect(syncHandler).toHaveBeenCalledWith(true);
  });

  it("inner 'synced' false does not set synced flag", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    mockInner._emitter.emit('synced', { synced: false });
    expect(provider.synced).toBe(false);
  });
});

describe('WebRTCProvider computed properties', () => {
  it('connectionState reflects inner.connected and inner.shouldConnect', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());

    mockInner.connected = false;
    mockInner.shouldConnect = false;
    expect(provider.connectionState).toEqual({ status: 'disconnected', intent: 'disconnected' });

    mockInner.connected = true;
    mockInner.shouldConnect = true;
    expect(provider.connectionState).toEqual({ status: 'connected', intent: 'connected' });

    mockInner.connected = false;
    mockInner.shouldConnect = true;
    expect(provider.connectionState).toEqual({ status: 'disconnected', intent: 'connected' });
  });

  it('intent reflects inner.shouldConnect', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    mockInner.shouldConnect = false;
    expect(provider.intent).toBe('disconnected');
    mockInner.shouldConnect = true;
    expect(provider.intent).toBe('connected');
  });
});

describe('WebRTCProvider no-op methods', () => {
  it('refreshToken returns urlChanged:false and empty newUrl', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.refreshToken('http://x', 'doc', 'tok', false)).toEqual({
      urlChanged: false,
      newUrl: '',
    });
  });

  it('hasUrl always returns true', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.hasUrl('http://anything')).toBe(true);
    expect(provider.hasUrl('')).toBe(true);
  });

  it('canReconnect always returns true', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.canReconnect()).toBe(true);
  });

  it('_pendingMessages is always empty array', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider._pendingMessages).toEqual([]);
  });

  it('beforeReconnect is null by default', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.beforeReconnect).toBeNull();
  });
});

describe('WebRTCProvider read-only guard', () => {
  it('logs an error when a local write occurs on a read-only doc', () => {
    const doc = new Y.Doc();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    new WebRTCProvider('room', doc, undefined, { readOnly: true });

    // Simulate a local write (origin === null)
    doc.emit('update', [new Uint8Array(), null]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('read-only'));
    errorSpy.mockRestore();
  });

  it('does not log when origin is non-null (remote update)', () => {
    const doc = new Y.Doc();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    new WebRTCProvider('room', doc, undefined, { readOnly: true });

    // Simulate a remote update (origin === provider instance)
    doc.emit('update', [new Uint8Array(), {}]);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not register the update listener when not read-only', () => {
    const doc = new Y.Doc();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    new WebRTCProvider('room', doc);

    doc.emit('update', [new Uint8Array(), null]);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
