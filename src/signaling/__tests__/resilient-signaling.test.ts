jest.useFakeTimers();

// Mock BulletinSignalingTransport.create so tests don't open real servers
const mockBulletinTransport = {
  signalingUrls: ['ws://127.0.0.1:9999'],
  destroy: jest.fn(),
};
jest.mock('../BulletinSignalingTransport', () => ({
  BulletinSignalingTransport: {
    create: jest.fn().mockResolvedValue(mockBulletinTransport),
  },
}));

import { ResilientSignalingTransport } from '../ResilientSignalingTransport';
import { BulletinSignalingTransport } from '../BulletinSignalingTransport';

const makeSettings = (overrides = {}) => ({
  signalingUrls: ['wss://signaling.y-webrtc.com'],
  signalingFallbackTimeoutMs: 8000,
  ...overrides,
});

describe('ResilientSignalingTransport', () => {
  beforeEach(() => jest.clearAllMocks());

  test('exposes primary signalingUrls immediately', () => {
    const t = new ResilientSignalingTransport(makeSettings(), {} as any, jest.fn());
    expect(t.signalingUrls).toEqual(['wss://signaling.y-webrtc.com']);
    t.destroy();
  });

  test('onPeerConnected() cancels the fallback timer', async () => {
    const onFallback = jest.fn();
    const t = new ResilientSignalingTransport(makeSettings(), {} as any, onFallback);

    t.onPeerConnected!();
    jest.advanceTimersByTime(10000);
    await Promise.resolve(); // flush microtasks

    expect(onFallback).not.toHaveBeenCalled();
    t.destroy();
  });

  test('timer fires and calls onFallback with bulletin transport', async () => {
    const onFallback = jest.fn();
    const mockClient = {};
    const t = new ResilientSignalingTransport(makeSettings(), mockClient as any, onFallback);

    jest.advanceTimersByTime(8000);
    await Promise.resolve();
    await Promise.resolve(); // flush BulletinSignalingTransport.create promise

    expect(BulletinSignalingTransport.create).toHaveBeenCalledWith(mockClient);
    expect(onFallback).toHaveBeenCalledWith(mockBulletinTransport);
    t.destroy();
  });

  test('timer does not fire when timeoutMs is 0', async () => {
    const onFallback = jest.fn();
    const t = new ResilientSignalingTransport(
      makeSettings({ signalingFallbackTimeoutMs: 0 }),
      {} as any,
      onFallback,
    );

    jest.advanceTimersByTime(30000);
    await Promise.resolve();

    expect(onFallback).not.toHaveBeenCalled();
    t.destroy();
  });

  test('timer does not fire when bulletinClient is null', async () => {
    const onFallback = jest.fn();
    const t = new ResilientSignalingTransport(makeSettings(), null, onFallback);

    jest.advanceTimersByTime(8000);
    await Promise.resolve();

    expect(onFallback).not.toHaveBeenCalled();
    t.destroy();
  });

  test('destroy() cancels timer and does not call onFallback', async () => {
    const onFallback = jest.fn();
    const t = new ResilientSignalingTransport(makeSettings(), {} as any, onFallback);

    t.destroy();
    jest.advanceTimersByTime(8000);
    await Promise.resolve();

    expect(onFallback).not.toHaveBeenCalled();
  });
});
