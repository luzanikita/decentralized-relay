// src/control-plane/IControlPlane.ts

export interface SessionParams {
  docId: string;
  authorization: 'full' | 'read-only';
  relayUrl?: string;   // absent in decentralized path
  relayToken?: string; // absent in decentralized path
}

export interface IControlPlane {
  getSession(resourceId: string): Promise<SessionParams>;
  destroy(): void;
}
