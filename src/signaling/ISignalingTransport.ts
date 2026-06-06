export interface ISignalingTransport {
  /** WebSocket URLs passed to y-webrtc's WebrtcProvider signaling option. */
  readonly signalingUrls: string[];
  /** Clean up resources. Must be idempotent. */
  destroy(): void;
  /**
   * Called by WebRTCProvider when the first peer connects successfully.
   * Optional — only ResilientSignalingTransport uses it to cancel the fallback timer.
   */
  onPeerConnected?(): void;
}
