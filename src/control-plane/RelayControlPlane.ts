import type { LiveTokenStore } from '../LiveTokenStore';
import type { IControlPlane, SessionParams } from './IControlPlane';

export class RelayControlPlane implements IControlPlane {
  constructor(private readonly tokenStore: LiveTokenStore) {}

  async getSession(resourceId: string): Promise<SessionParams> {
    const token = await this.tokenStore.getToken(
      resourceId,
      resourceId,
      () => {}, // background refresh noop — beforeReconnect handles freshness
    );
    return {
      docId: token.docId,
      authorization: token.authorization ?? 'full',
      relayUrl: token.url,
      relayToken: token.token,
    };
  }

  destroy(): void {}
}
