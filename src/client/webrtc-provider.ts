import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { EventEmitter } from 'events';
import { WebrtcProvider } from 'y-webrtc';
import type {
  ConnectionState,
  ConnectionIntent,
  IRelayProvider,
  BeforeReconnect,
} from './provider';

const DEFAULT_SIGNALING = ['wss://signaling.y-webrtc.com'];

export type User = { name: string; color?: string };

export class WebRTCProvider implements IRelayProvider {
  private inner: WebrtcProvider;
  private emitter = new EventEmitter();
  synced = false;
  beforeReconnect: BeforeReconnect | null = null;
  _pendingMessages: unknown[] = [];

  constructor(
    docId: string,
    ydoc: Y.Doc,
    _user?: User,
    options?: { signalingUrls?: string[]; readOnly?: boolean },
  ) {
    this.inner = new WebrtcProvider(docId, ydoc, {
      signaling: options?.signalingUrls ?? DEFAULT_SIGNALING,
    });
    if (options?.readOnly) {
      // WebRTC cannot enforce read-only at the transport layer. Log an error
      // if the local application writes to the doc so the violation is visible.
      ydoc.on('update', (_update: Uint8Array, origin: unknown) => {
        if (origin === null) {
          console.error(
            '[WebRTCProvider] Local write on a read-only document — ' +
            'WebRTC cannot enforce read-only. Upgrade to a gated signaling server.',
          );
        }
      });
    }
    this._bindInnerEvents();
  }

  connect(): void {
    this.inner.shouldConnect = true;
    this.inner.connect();
  }

  disconnect(): void {
    this.inner.disconnect();
  }

  destroy(): void {
    this.inner.destroy();
  }

  get awareness(): awarenessProtocol.Awareness {
    return this.inner.awareness;
  }

  on(event: string, cb: (...args: any[]) => void): void {
    this.emitter.on(event, cb);
  }

  off(event: string, cb: (...args: any[]) => void): void {
    this.emitter.off(event, cb);
  }

  get connectionState(): ConnectionState {
    return {
      status: this.inner.connected ? 'connected' : 'disconnected',
      intent: this.inner.shouldConnect ? 'connected' : 'disconnected',
    };
  }

  get intent(): ConnectionIntent {
    return this.inner.shouldConnect ? 'connected' : 'disconnected';
  }

  refreshToken(
    _url: string,
    _docId: string,
    _token: string,
    _readOnly: boolean,
  ): { urlChanged: boolean; newUrl: string } {
    return { urlChanged: false, newUrl: '' };
  }

  hasUrl(_url: string): boolean {
    return true;
  }

  canReconnect(): boolean {
    return true;
  }

  private _bindInnerEvents(): void {
    this.inner.on('status', ({ connected }: { connected: boolean }) => {
      const intent: ConnectionIntent = this.inner.shouldConnect ? 'connected' : 'disconnected';
      this.emitter.emit('status', {
        status: connected ? 'connected' : 'disconnected',
        intent,
      });
      if (!connected) {
        this.emitter.emit('connection-close');
      }
    });

    this.inner.on('synced', ({ synced }: { synced: boolean }) => {
      if (synced) {
        this.synced = true;
      }
      this.emitter.emit('synced', synced);
    });
  }
}
