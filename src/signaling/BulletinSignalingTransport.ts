import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import type { ISignalingTransport } from './ISignalingTransport';
import type { BulletinClient } from '../bulletin/BulletinClient';

interface SignalEnvelope {
  d: string;    // docId
  f: string;    // sender accountId
  p: unknown;   // y-webrtc signal payload
}

export class BulletinSignalingTransport implements ISignalingTransport {
  private _signalingUrls: string[] = [];
  private _server!: http.Server;
  private _wss!: WebSocketServer;
  private _wsClient: WebSocket | null = null;
  private _subscribedDocId: string | null = null;
  private _unsubscribeBlocks: (() => void) | null = null;
  private _destroyed = false;

  private constructor(private readonly _bulletinClient: BulletinClient) {}

  static async create(bulletinClient: BulletinClient): Promise<BulletinSignalingTransport> {
    const t = new BulletinSignalingTransport(bulletinClient);
    await t._init();
    return t;
  }

  private _init(): Promise<void> {
    return new Promise((resolve) => {
      this._server = http.createServer();
      this._server.listen(0, '127.0.0.1', () => {
        const port = (this._server.address() as AddressInfo).port;
        this._signalingUrls = [`ws://127.0.0.1:${port}`];
        this._wss = new WebSocketServer({ server: this._server });
        this._wss.on('connection', (ws: WebSocket) => this._handleConnection(ws));
        resolve();
      });
    });
  }

  get signalingUrls(): string[] {
    return this._signalingUrls;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._unsubscribeBlocks?.();
    this._unsubscribeBlocks = null;
    this._wss?.close();
    this._server?.close();
  }

  private _handleConnection(ws: WebSocket): void {
    this._wsClient = ws;
    ws.on('message', (raw: Buffer) => this._handleMessage(raw.toString()));
    ws.on('ping', () => ws.send(JSON.stringify({ type: 'pong' })));
  }

  private _handleMessage(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'subscribe' && Array.isArray(msg.topics) && msg.topics.length > 0) {
      this._subscribedDocId = msg.topics[0];
      this._startBlockSubscription();
    }

    if (msg.type === 'publish' && msg.data?.type !== 'awareness') {
      void this._sendSignal(msg.topic as string, msg.data);
    }
  }

  private async _sendSignal(docId: string, payload: unknown): Promise<void> {
    const envelope: SignalEnvelope = {
      d: docId,
      f: this._bulletinClient.accountId,
      p: payload,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    try {
      await this._bulletinClient.store(bytes);
    } catch (e) {
      console.error('[BulletinSignalingTransport] failed to store signal:', e);
    }
  }

  private _startBlockSubscription(): void {
    if (this._unsubscribeBlocks) return;
    void this._bulletinClient.connect().then(() => {
      if (this._destroyed) return;
      this._unsubscribeBlocks = this._bulletinClient.subscribeToStoredCids(
        (cid) => void this._handleInboundCid(cid),
      );
    });
  }

  private async _handleInboundCid(cid: string): Promise<void> {
    if (!this._wsClient || !this._subscribedDocId || this._destroyed) return;
    try {
      const bytes = await this._bulletinClient.fetch(cid);
      const envelope = JSON.parse(new TextDecoder().decode(bytes)) as SignalEnvelope;
      if (envelope.d !== this._subscribedDocId) return;
      if (envelope.f === this._bulletinClient.accountId) return;
      this._wsClient.send(
        JSON.stringify({ type: 'message', from: envelope.f, data: envelope.p }),
      );
    } catch {
      // not a signal envelope or fetch failed — skip
    }
  }
}
