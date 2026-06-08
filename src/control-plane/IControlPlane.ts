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

export class NotAuthorizedError extends Error {
  constructor(folderId: string) {
    super(`Not authorized to access folder ${folderId}`);
    this.name = 'NotAuthorizedError';
  }
}
