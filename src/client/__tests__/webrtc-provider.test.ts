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

  it('uses custom signaling URLs when provided', () => {
    const doc = new Y.Doc();
    new WebRTCProvider('doc-abc-123', doc, undefined, {
      signalingUrls: ['wss://custom.example.com'],
    });
    expect(MockWebrtcProvider).toHaveBeenCalledWith(
      'doc-abc-123',
      doc,
      expect.objectContaining({ signaling: ['wss://custom.example.com'] }),
    );
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
