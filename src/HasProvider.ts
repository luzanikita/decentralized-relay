"use strict";
import * as Y from "yjs";
import {
	type IRelayProvider,
	type ConnectionState,
	type ConnectionIntent,
} from "./client/provider";
export type { ConnectionState, ConnectionIntent };
import { WebRTCProvider } from "./client/webrtc-provider";
import { User } from "./User";
import { HasLogging } from "./debug";
import { LoginManager } from "./LoginManager";
import { LiveTokenStore } from "./LiveTokenStore";
import type { IControlPlane, SessionParams } from './control-plane/IControlPlane';
import { S3RN, type S3RNType } from "./S3RN";
import type { TimeProvider } from "./TimeProvider";
import type { ISignalingTransport } from "./signaling/ISignalingTransport";
import { PublicSignalingTransport } from "./signaling/PublicSignalingTransport";
import type { BulletinSignalingTransport } from "./signaling/BulletinSignalingTransport";

const DEFERRED_DOC_ID = '-';

export interface Subscription {
	on: () => void;
	off: () => void;
}

function makeProvider(
	sessionParams: SessionParams,
	ydoc: Y.Doc,
	user: User | undefined,
	_timeProvider: TimeProvider,
	transport?: ISignalingTransport,
): IRelayProvider {
	const provider = new WebRTCProvider(
		sessionParams.docId,
		ydoc,
		user ? { name: user.name } : undefined,
		{ transport, readOnly: sessionParams.authorization === 'read-only' },
	);

	if (user) {
		provider.awareness.setLocalStateField("user", {
			name: user.name,
			id: user.id,
			color: user.color.color,
			colorLight: user.color.light,
		});
	}
	return provider;
}

/** Disconnected state returned when no provider exists */
const DISCONNECTED_STATE: ConnectionState = {
	status: "disconnected",
} as ConnectionState;

type ConnectionCloseDetails = {
	code: number | null;
	reason: string;
	wasClean: boolean | null;
};

function connectionCloseDetails(event: CloseEvent): ConnectionCloseDetails {
	return {
		code: typeof event.code === "number" ? event.code : null,
		reason: typeof event.reason === "string" ? event.reason : "",
		wasClean: typeof event.wasClean === "boolean" ? event.wasClean : null,
	};
}

type Listener = (state: ConnectionState) => void;

export class HasProvider extends HasLogging {
	_provider: IRelayProvider | null = null;
	path?: string;
	private _ydoc: Y.Doc | null = null;
	protected _signalingTransport: ISignalingTransport | null = null;
	protected _destroyed = false;
	sessionParams: SessionParams;
	private _deferredDisconnectTimer: number | null = null;
	private _deferredDisconnectStatusListener:
		| ((state: ConnectionState) => void)
		| null = null;
	private _providerSyncAbortHandlers = new Set<(reason: Error) => void>();
	// Track whether the current provider connection has completed sync.
	// This must reset on disconnect so reconnect flows do not treat a
	// stale connection as ready.
	_providerSynced: boolean = false;
	private _offConnectionError: (() => void) | null = null;
	private _offConnectionClose: (() => void) | null = null;
	private _offState: (() => void) | null = null;
	listeners: Map<unknown, Listener>;
	timeProvider!: TimeProvider;

	constructor(
		public guid: string,
		private _s3rn: S3RNType,
		public tokenStore: LiveTokenStore,
		public loginManager: LoginManager,
		private _controlPlane: IControlPlane,
	) {
		super();
		this.listeners = new Map<unknown, Listener>();
		this.loginManager = loginManager;
		this.tokenStore = tokenStore;

		const cachedToken = this.tokenStore.getTokenSync(S3RN.encode(this.s3rn));
		this.sessionParams = cachedToken
			? {
					docId: cachedToken.docId,
					authorization: cachedToken.authorization ?? 'full',
					relayUrl: cachedToken.url,
					relayToken: cachedToken.token,
				}
			: { docId: DEFERRED_DOC_ID, authorization: 'full' };
	}

	/**
	 * Get the remote YDoc. Lazily creates it on first access.
	 * Most callers should use this property for backward compatibility.
	 */
	public get ydoc(): Y.Doc {
		if (!this._ydoc) {
			this.ensureRemoteDoc();
		}
		return this._ydoc!;
	}

	/**
	 * Get the remote YDoc without creating it.
	 * Returns null if the remoteDoc has not been created yet.
	 */
	public get remoteDocOrNull(): Y.Doc | null {
		return this._ydoc;
	}

	/**
	 * Check if the remote YDoc and provider are currently loaded.
	 */
	public get isRemoteDocLoaded(): boolean {
		return this._ydoc !== null;
	}

	/**
	 * Create the remote YDoc and provider if they don't exist.
	 * Returns the YDoc for convenience.
	 */
	ensureRemoteDoc(): Y.Doc {
		if (this._ydoc) {
			return this._ydoc;
		}

		this._ydoc = new Y.Doc();

		if (this.sessionParams.docId !== DEFERRED_DOC_ID) {
			this._createProvider();
		}

		return this._ydoc;
	}

	private _createProvider(): void {
		if (this._provider || !this._ydoc) return;
		const user = this.loginManager?.user;
		this._signalingTransport = this._buildSignalingTransport();
		this._provider = makeProvider(
			this.sessionParams,
			this._ydoc,
			user,
			this.timeProvider,
			this._signalingTransport,
		);
		this._provider.beforeReconnect = async () => {
			const sessionParams = await this.getSessionParams();
			this.refreshProvider(sessionParams);
		};

		const connectionErrorSub = this.providerConnectionErrorSubscription(
			(event) => {
				this.log(`[${this.path}] connection error`, event);
			},
		);
		connectionErrorSub.on();
		this._offConnectionError = connectionErrorSub.off;

		const connectionCloseSub = this.providerConnectionCloseSubscription(
			(event) => {
				this.log(
					`[${this.path}] connection close`,
					connectionCloseDetails(event),
				);
			},
		);
		connectionCloseSub.on();
		this._offConnectionClose = connectionCloseSub.off;

		const stateSub = this.providerStateSubscription(
			(state: ConnectionState) => {
				if (state.status !== "connected") {
					this._providerSynced = false;
				}
				this.notifyListeners();
			},
		);
		stateSub.on();
		this._offState = stateSub.off;
	}

	/**
	 * Destroy the remote YDoc and provider, freeing memory.
	 * The document can be re-created later via ensureRemoteDoc().
	 */
	destroyRemoteDoc(): void {
		this.abortProviderSyncWaiters(
			new Error("Provider was destroyed before sync completed"),
		);
		if (this._offConnectionError) {
			this._offConnectionError();
			this._offConnectionError = null;
		}
		if (this._offConnectionClose) {
			this._offConnectionClose();
			this._offConnectionClose = null;
		}
		if (this._offState) {
			this._offState();
			this._offState = null;
		}
		if (this._provider) {
			this._provider.destroy();
			this._provider = null;
		}
		if (this._ydoc) {
			this._ydoc.destroy();
			this._ydoc = null;
		}
		this._providerSynced = false;
	}

	public get s3rn(): S3RNType {
		return this._s3rn;
	}

	public set s3rn(value: S3RNType) {
		this._s3rn = value;
		if (this._provider) {
			this.refreshProvider(this.sessionParams);
		}
	}

	notifyListeners() {
		this.debug("[Provider State]", this.path, this.state);
		this.listeners.forEach((listener) => {
			listener(this.state);
		});
	}

	subscribe(el: unknown, listener: Listener): () => void {
		this.listeners.set(el, listener);
		return () => {
			this.unsubscribe(el);
		};
	}

	unsubscribe(el: unknown) {
		this.listeners.delete(el);
	}

	async getSessionParams(): Promise<SessionParams> {
		return this._controlPlane.getSession(S3RN.encode(this._s3rn));
	}

	providerActive() {
		return this._provider !== null && this.sessionParams.docId !== DEFERRED_DOC_ID;
	}

	refreshProvider(sessionParams: SessionParams) {
		this.sessionParams = sessionParams;

		if (!this._provider) {
			return;
		}

		if (sessionParams.relayUrl) {
			const result = this._provider.refreshToken(
				sessionParams.relayUrl,
				sessionParams.docId,
				sessionParams.relayToken ?? '',
				sessionParams.authorization === 'read-only',
			);
			if (result.urlChanged) {
				const maskedUrl = result.newUrl.replace(/token=[^&]+/, 'token=[REDACTED]');
				this.log(`Token Refreshed: setting new provider url, ${maskedUrl}`);
			}
		}
	}

	public get connected(): boolean {
		return this.state.status === "connected";
	}

	connect(): Promise<boolean> {
		if (this.connected) {
			return Promise.resolve(true);
		}
		this.ensureRemoteDoc();
		return this.getSessionParams()
			.then((sessionParams) => {
				this.sessionParams = sessionParams;
				if (!this._provider) {
					this._createProvider();
				} else {
					this.refreshProvider(sessionParams);
				}
				if (this._provider) {
					this._provider.connect();
				}
				this.notifyListeners();
				return true;
			})
			.catch((e) => {
				this.abortProviderSyncWaiters(
					new Error("Provider connection failed before sync completed"),
				);
				return false;
			});
	}

	public get state(): ConnectionState {
		if (!this._provider) {
			return DISCONNECTED_STATE;
		}
		return this._provider.connectionState;
	}

	get intent(): ConnectionIntent {
		if (!this._provider) {
			return "disconnected" as ConnectionIntent;
		}
		return this._provider.intent;
	}

	public get synced(): boolean {
		return this._providerSynced;
	}

	private clearDeferredDisconnect(): void {
		if (this._deferredDisconnectTimer !== null) {
			this.timeProvider.clearTimeout(this._deferredDisconnectTimer);
			this._deferredDisconnectTimer = null;
		}
		if (this._provider && this._deferredDisconnectStatusListener) {
			this._provider.off("status", this._deferredDisconnectStatusListener);
		}
		this._deferredDisconnectStatusListener = null;
	}

	deferDisconnectForPendingMessages(_timeoutMs: number = 2000): boolean {
		return false;
	}

	disconnect() {
		this.clearDeferredDisconnect();
		this.abortProviderSyncWaiters(
			new Error("Provider disconnected before sync completed"),
		);
		this._providerSynced = false;
		if (this._provider) {
			this._provider.disconnect();
		}
		this.tokenStore.removeFromRefreshQueue(this.guid);
		this.notifyListeners();
	}

	public withActiveProvider<T extends HasProvider>(this: T): Promise<T> {
		if (this.providerActive()) {
			return Promise.resolve(this);
		}
		return this.getSessionParams().then(() => this);
	}

	onceConnected(): Promise<void> {
		this.ensureRemoteDoc();
		if (this.state.status === "connected") {
			return Promise.resolve();
		}
		if (!this._provider) {
			// Deferred path: provider not yet created, trigger connect then retry
			return this.connect().then(() => this.onceConnected());
		}
		const provider = this._provider;
		return new Promise((resolve) => {
			const resolveOnConnect = (state: ConnectionState) => {
				if (state.status === "connected") {
					provider.off("status", resolveOnConnect);
					resolve();
				}
			};
			provider.on("status", resolveOnConnect);
		});
	}

	onceProviderSynced(): Promise<void> {
		if (this._providerSynced) {
			return Promise.resolve();
		}
		this.ensureRemoteDoc();
		if (!this._provider) {
			return this.connect().then(() => this.onceProviderSynced());
		}
		const provider = this._provider;
		if (provider.synced) {
			this._providerSynced = true;
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				provider.off("synced", handleSynced);
				provider.off("status", handleStatus);
				provider.off("connection-error", handleConnectionError);
				this._providerSyncAbortHandlers.delete(abort);
			};
			const finish = () => {
				if (settled) return;
				settled = true;
				cleanup();
				this._providerSynced = true;
				resolve();
			};
			const fail = (reason: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(reason);
			};
			const abort = (reason: Error) => {
				fail(reason);
			};
			const checkTerminalState = () => {
				if (this._provider !== provider) {
					fail(new Error("Provider was replaced before sync completed"));
					return;
				}
				if (this._providerSynced || provider.synced) {
					finish();
					return;
				}
				const state = provider.connectionState;
				if (
					state.status === "disconnected" &&
					state.intent === "connected" &&
					!provider.canReconnect()
				) {
					fail(new Error("Provider retries were exhausted before sync completed"));
					return;
				}
			};
			const handleSynced = (synced: boolean) => {
				if (!synced) return;
				finish();
			};
			const handleStatus = () => {
				checkTerminalState();
			};
			const handleConnectionError = () => {
				checkTerminalState();
			};
			provider.on("synced", handleSynced);
			provider.on("status", handleStatus);
			provider.on("connection-error", handleConnectionError);
			this._providerSyncAbortHandlers.add(abort);
			checkTerminalState();
		});
	}

	private abortProviderSyncWaiters(reason: Error): void {
		for (const abort of Array.from(this._providerSyncAbortHandlers)) {
			abort(reason);
		}
		this._providerSyncAbortHandlers.clear();
	}

	reset() {
		this.disconnect();
		this.sessionParams = { docId: DEFERRED_DOC_ID, authorization: 'full' };
	}


	private providerConnectionErrorSubscription(
		f: (event: Event) => void,
	): Subscription {
		const on = () => {
			this._provider?.on("connection-error", f);
		};
		const off = () => {
			this._provider?.off("connection-error", f);
		};
		return { on, off } as Subscription;
	}

	private providerConnectionCloseSubscription(
		f: (event: CloseEvent) => void,
	): Subscription {
		const on = () => {
			this._provider?.on("connection-close", f);
		};
		const off = () => {
			this._provider?.off("connection-close", f);
		};
		return { on, off } as Subscription;
	}

	protected providerStateSubscription(
		f: (state: ConnectionState) => void,
	): Subscription {
		const on = () => {
			this._provider?.on("status", f);
		};
		const off = () => {
			this._provider?.off("status", f);
		};
		return { on, off } as Subscription;
	}

	protected _buildSignalingTransport(): ISignalingTransport {
		return new PublicSignalingTransport();
	}

	protected _handleSignalingFallback(newTransport: BulletinSignalingTransport): void {
		const ydoc = this._ydoc;
		if (!ydoc || this._destroyed) return;
		this._provider?.destroy();
		const user = this.loginManager?.user;
		this._signalingTransport = newTransport;
		this._provider = makeProvider(
			this.sessionParams,
			ydoc,
			user,
			this.timeProvider,
			newTransport,
		);
		this._provider.connect();
		this.notifyListeners();
	}

	destroy() {
		this._destroyed = true;
		this.destroyRemoteDoc();
		this.loginManager = null as any;
	}
}
