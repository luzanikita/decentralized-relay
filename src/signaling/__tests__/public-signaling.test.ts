import { PublicSignalingTransport } from '../PublicSignalingTransport';

describe('PublicSignalingTransport', () => {
  test('uses default URL when constructed with no arguments', () => {
    const t = new PublicSignalingTransport();
    expect(t.signalingUrls).toEqual(['wss://signaling.y-webrtc.com']);
  });

  test('uses provided URLs', () => {
    const urls = ['wss://a.example.com', 'wss://b.example.com'];
    const t = new PublicSignalingTransport(urls);
    expect(t.signalingUrls).toEqual(urls);
  });

  test('signalingUrls is the same array reference across calls', () => {
    const t = new PublicSignalingTransport();
    expect(t.signalingUrls).toBe(t.signalingUrls);
  });

  test('destroy() is a no-op and does not throw', () => {
    const t = new PublicSignalingTransport();
    expect(() => t.destroy()).not.toThrow();
    expect(() => t.destroy()).not.toThrow(); // idempotent
  });

  test('onPeerConnected is undefined', () => {
    const t = new PublicSignalingTransport();
    expect(t.onPeerConnected).toBeUndefined();
  });
});
