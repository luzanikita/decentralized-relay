# WebRTC Provider Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `YSweetProvider` (WebSocket → centralized relay) with a `WebRTCProvider` adapter (y-webrtc P2P) in the Relay Obsidian plugin fork.

**Architecture:** Extract `IRelayProvider` interface from the subset of `HasProvider`'s calls, implement a `WebRTCProvider` adapter that wraps `WebrtcProvider` from y-webrtc with matching events and property shapes, then update `HasProvider` to construct `WebRTCProvider` instead of `YSweetProvider`. The control plane, OAuth, `LiveTokenStore`, `ConnectionPool`, and `ProviderIntegration` are untouched.

**Tech Stack:** TypeScript, y-webrtc, yjs, y-protocols (awareness), Jest + ts-jest

---

## Design Reference

```
Control plane (OAuth, doc ID)
        ↓ ClientToken.docId
WebRTCProvider
        ↓ room name = docId
y-webrtc (WebRTC P2P)
        ↓ signaling only
wss://signaling.y-webrtc.com  (stateless, content-blind)
```

Document content travels peer-to-peer. The signaling server sees only room names and ICE candidates — never document data.

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add `y-webrtc` dependency |
| `src/client/provider.ts` | Modify | Add `IRelayProvider` interface alongside existing `ConnectionState`/`ConnectionIntent` types |
| `src/client/webrtc-provider.ts` | Create | `WebRTCProvider` adapter class wrapping y-webrtc's `WebrtcProvider` |
| `src/HasProvider.ts` | Modify | Use `IRelayProvider`, construct `WebRTCProvider`, update 3 methods, remove `debuggerUrl` |
| `src/client/__tests__/webrtc-provider.test.ts` | Create | Unit tests for `WebRTCProvider` |

---

## Task 1: Add y-webrtc dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add y-webrtc to package.json dependencies**

Open `package.json`. In the `dependencies` object add:

```json
"y-webrtc": "^10.3.0"
```

- [ ] **Step 2: Install and verify types load**

```bash
npm install
npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors. If TypeScript says `Cannot find module 'y-webrtc'`, check that `node_modules/y-webrtc/src/y-webrtc.d.ts` exists after install.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add y-webrtc"
```

---

## Task 2: Add IRelayProvider interface

**Files:**
- Modify: `src/client/provider.ts`
- Test: `src/client/__tests__/webrtc-provider.test.ts` (compile-time check only)

- [ ] **Step 1: Open src/client/provider.ts and locate the ConnectionState / ConnectionIntent types**

Read the file to understand existing exports. They look something like:

```ts
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
export type ConnectionIntent = 'connected' | 'disconnected';
export type ConnectionState = { status: ConnectionStatus; intent: ConnectionIntent };
```

Note the exact names — use them verbatim in the interface below.

- [ ] **Step 2: Add BeforeReconnect type and IRelayProvider interface**

Append to `src/client/provider.ts` (after existing exports):

```ts
import * as awarenessProtocol from 'y-protocols/awareness';

export type BeforeReconnect = () => Promise<void> | void;

export interface IRelayProvider {
  on(event: string, cb: (...args: any[]) => void): void;
  off(event: string, cb: (...args: any[]) => void): void;
  connect(): void;
  disconnect(): void;
  destroy(): void;
  awareness: awarenessProtocol.Awareness;
  connectionState: ConnectionState;
  synced: boolean;
  intent: ConnectionIntent;
  refreshToken(
    url: string,
    docId: string,
    token: string,
    readOnly: boolean,
  ): { urlChanged: boolean; newUrl: string };
  hasUrl(url: string): boolean;
  canReconnect(): boolean;
  _pendingMessages: unknown[];
  beforeReconnect: BeforeReconnect | null;
}
```

If `y-protocols/awareness` is not yet in `package.json`, check — it is a transitive dependency of yjs and should already be present. If not, add `"y-protocols": "^2.0.0"` to package.json.

- [ ] **Step 3: Verify the file compiles**

```bash
npx tsc --noEmit 2>&1 | grep provider.ts
```

Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/client/provider.ts
git commit -m "feat: add IRelayProvider interface and BeforeReconnect type"
```

---

## Task 3: WebRTCProvider — constructor + core delegation methods

**Files:**
- Create: `src/client/webrtc-provider.ts`
- Create: `src/client/__tests__/webrtc-provider.test.ts`

- [ ] **Step 1: Create the test file with a mock for y-webrtc**

Create `src/client/__tests__/webrtc-provider.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails (WebRTCProvider does not exist yet)**

```bash
npx jest src/client/__tests__/webrtc-provider.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../webrtc-provider'`

- [ ] **Step 3: Create src/client/webrtc-provider.ts with minimal passing implementation**

```ts
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebrtcProvider } from 'y-webrtc';
import {
  ConnectionState,
  ConnectionIntent,
  IRelayProvider,
  BeforeReconnect,
} from './provider';

const DEFAULT_SIGNALING = ['wss://signaling.y-webrtc.com'];

export type User = { name: string; color?: string };

export class WebRTCProvider implements IRelayProvider {
  private inner: WebrtcProvider;
  synced = false;
  beforeReconnect: BeforeReconnect | null = null;
  _pendingMessages: unknown[] = [];

  constructor(
    docId: string,
    ydoc: Y.Doc,
    _user?: User,
    options?: { signalingUrls?: string[] },
  ) {
    this.inner = new WebrtcProvider(docId, ydoc, {
      signaling: options?.signalingUrls ?? DEFAULT_SIGNALING,
    });
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
    this.inner.on(event, cb);
  }

  off(event: string, cb: (...args: any[]) => void): void {
    this.inner.off(event, cb);
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
    // placeholder — event binding added in Task 4
  }
}
```

- [ ] **Step 4: Run the constructor + delegation tests**

```bash
npx jest src/client/__tests__/webrtc-provider.test.ts --no-coverage
```

Expected: PASS — all tests in `WebRTCProvider constructor` and `WebRTCProvider delegation` groups.

- [ ] **Step 5: Commit**

```bash
git add src/client/webrtc-provider.ts src/client/__tests__/webrtc-provider.test.ts
git commit -m "feat: WebRTCProvider skeleton with constructor and delegation"
```

---

## Task 4: WebRTCProvider — event mapping

**Files:**
- Modify: `src/client/webrtc-provider.ts`
- Modify: `src/client/__tests__/webrtc-provider.test.ts`

- [ ] **Step 1: Add event mapping tests to webrtc-provider.test.ts**

Append after the `WebRTCProvider delegation` describe block:

```ts
describe('WebRTCProvider event mapping', () => {
  it("inner 'status' {connected:true} emits 'status' with status:connected, intent:connected", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    const handler = jest.fn();
    provider.on('status', handler);

    mockInner.connected = true;
    mockInner.shouldConnect = true;
    mockInner._emitter.emit('status', { connected: true });

    expect(handler).toHaveBeenCalledWith({ status: 'connected', intent: 'connected' });
  });

  it("inner 'status' {connected:false} emits 'status' with status:disconnected", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    const statusHandler = jest.fn();
    provider.on('status', statusHandler);

    mockInner.connected = false;
    mockInner.shouldConnect = true;
    mockInner._emitter.emit('status', { connected: false });

    expect(statusHandler).toHaveBeenCalledWith({ status: 'disconnected', intent: 'connected' });
  });

  it("inner 'status' {connected:false} also emits 'connection-close'", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    const closeHandler = jest.fn();
    provider.on('connection-close', closeHandler);

    mockInner._emitter.emit('status', { connected: false });

    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  it("inner 'synced' true sets synced flag and emits 'synced' true", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    const syncHandler = jest.fn();
    provider.on('synced', syncHandler);

    expect(provider.synced).toBe(false);
    mockInner._emitter.emit('synced', true);

    expect(provider.synced).toBe(true);
    expect(syncHandler).toHaveBeenCalledWith(true);
  });

  it("inner 'synced' false does not set synced flag", () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    mockInner._emitter.emit('synced', false);
    expect(provider.synced).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm event tests fail**

```bash
npx jest src/client/__tests__/webrtc-provider.test.ts --no-coverage
```

Expected: FAIL — event mapping tests fail because `_bindInnerEvents` is a no-op.

- [ ] **Step 3: Implement event forwarding in _bindInnerEvents**

The problem with the current `on`/`off` delegation is that it passes outer listeners directly to the inner provider's event system, but we need to intercept events and re-emit them with transformed payloads. We need an `EventEmitter` on the adapter itself.

Replace the `WebRTCProvider` class body in `src/client/webrtc-provider.ts` with:

```ts
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { EventEmitter } from 'events';
import { WebrtcProvider } from 'y-webrtc';
import {
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
    options?: { signalingUrls?: string[] },
  ) {
    this.inner = new WebrtcProvider(docId, ydoc, {
      signaling: options?.signalingUrls ?? DEFAULT_SIGNALING,
    });
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

    this.inner.on('synced', (synced: boolean) => {
      if (synced) {
        this.synced = true;
      }
      this.emitter.emit('synced', synced);
    });
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npx jest src/client/__tests__/webrtc-provider.test.ts --no-coverage
```

Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/webrtc-provider.ts src/client/__tests__/webrtc-provider.test.ts
git commit -m "feat: WebRTCProvider event mapping (status, synced, connection-close)"
```

---

## Task 5: WebRTCProvider — computed property tests

**Files:**
- Modify: `src/client/__tests__/webrtc-provider.test.ts`

These properties are already implemented. This task adds explicit coverage tests.

- [ ] **Step 1: Add property tests**

Append to `webrtc-provider.test.ts`:

```ts
describe('WebRTCProvider computed properties', () => {
  it('connectionState reflects inner.connected and inner.shouldConnect', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());

    mockInner.connected = false;
    mockInner.shouldConnect = false;
    expect(provider.connectionState).toEqual({ status: 'disconnected', intent: 'disconnected' });

    mockInner.connected = true;
    mockInner.shouldConnect = true;
    expect(provider.connectionState).toEqual({ status: 'connected', intent: 'connected' });

    mockInner.connected = false;
    mockInner.shouldConnect = true;
    expect(provider.connectionState).toEqual({ status: 'disconnected', intent: 'connected' });
  });

  it('intent reflects inner.shouldConnect', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    mockInner.shouldConnect = false;
    expect(provider.intent).toBe('disconnected');
    mockInner.shouldConnect = true;
    expect(provider.intent).toBe('connected');
  });
});

describe('WebRTCProvider no-op methods', () => {
  it('refreshToken returns urlChanged:false and empty newUrl', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.refreshToken('http://x', 'doc', 'tok', false)).toEqual({
      urlChanged: false,
      newUrl: '',
    });
  });

  it('hasUrl always returns true', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.hasUrl('http://anything')).toBe(true);
    expect(provider.hasUrl('')).toBe(true);
  });

  it('canReconnect always returns true', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.canReconnect()).toBe(true);
  });

  it('_pendingMessages is always empty array', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider._pendingMessages).toEqual([]);
  });

  it('beforeReconnect is null by default', () => {
    const provider = new WebRTCProvider('room', new Y.Doc());
    expect(provider.beforeReconnect).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm all pass**

```bash
npx jest src/client/__tests__/webrtc-provider.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/client/__tests__/webrtc-provider.test.ts
git commit -m "test: add coverage for WebRTCProvider computed properties and no-ops"
```

---

## Task 6: Update HasProvider — provider type and makeProvider()

**Files:**
- Modify: `src/HasProvider.ts`

- [ ] **Step 1: Read HasProvider.ts to understand current structure**

Open `src/HasProvider.ts`. Find:
1. The `_provider` field declaration (type is `YSweetProvider | null`)
2. The `makeProvider()` method (constructs `new YSweetProvider(...)`)
3. Any `import` lines for `YSweetProvider`

Note the constructor arguments `makeProvider()` passes to `YSweetProvider` — you need `doc` (the Y.Doc), `docId`, and any token/url values. These come from `ClientToken`.

- [ ] **Step 2: Update the import block**

Replace the `YSweetProvider` import with:

```ts
import { WebRTCProvider } from './client/webrtc-provider';
import { IRelayProvider } from './client/provider';
```

Keep the `ConnectionState`, `ConnectionIntent` imports from `./client/provider` if they were already there — just add `IRelayProvider` to that import.

Remove any `import { YSweetProvider } from '@y-sweet/client'` line if it is only used for `_provider`.

- [ ] **Step 3: Change _provider field type**

Find:

```ts
private _provider: YSweetProvider | null = null;
```

Change to:

```ts
private _provider: IRelayProvider | null = null;
```

- [ ] **Step 4: Replace makeProvider() body**

Find the `makeProvider()` method. Its current body creates a `YSweetProvider`. Replace the body so it creates a `WebRTCProvider` instead.

The `docId` comes from `this._token.docId` (or wherever `ClientToken.docId` is accessed in the existing method — use the same variable). The `ydoc` is likely `this._doc` or passed via parameter.

```ts
private makeProvider(): IRelayProvider {
  return new WebRTCProvider(this._token.docId, this._doc);
}
```

Adjust field names to match what the existing `makeProvider()` uses. Do not change anything else in `makeProvider()`.

- [ ] **Step 5: Run existing tests**

```bash
npm test 2>&1 | tail -30
```

Expected: existing tests still pass. If TypeScript errors appear, they will point to method calls on `_provider` that do not exist on `IRelayProvider` — those are fixed in Task 7.

- [ ] **Step 6: Commit**

```bash
git add src/HasProvider.ts
git commit -m "feat: HasProvider uses WebRTCProvider via IRelayProvider"
```

---

## Task 7: Update HasProvider — remaining method changes

**Files:**
- Modify: `src/HasProvider.ts`

- [ ] **Step 1: Update refreshProvider() to be a no-op**

Find `refreshProvider()`. Its current body refreshes the WebSocket URL using the token. Replace the body with an early return:

```ts
async refreshProvider(
  url: string,
  docId: string,
  token: string,
  readOnly: boolean,
): Promise<void> {
  // WebRTC provider has no URL to refresh
  return;
}
```

Keep the signature identical so callers do not break.

- [ ] **Step 2: Update deferDisconnectForPendingMessages() to always return false**

Find `deferDisconnectForPendingMessages()`. Replace its body:

```ts
private deferDisconnectForPendingMessages(): boolean {
  return false;
}
```

- [ ] **Step 3: Remove debuggerUrl getter**

Find and delete the `debuggerUrl` getter entirely. It was y-sweet specific:

```ts
// DELETE THIS — no longer applicable
get debuggerUrl(): string | null { ... }
```

If any other code in the class calls `this.debuggerUrl`, remove those call sites too.

- [ ] **Step 4: Run full type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. If errors remain, they are type mismatches between what `HasProvider` calls on `_provider` and what `IRelayProvider` exposes — read the error, locate the call, and add the missing method to `IRelayProvider` in `src/client/provider.ts` plus a stub implementation in `WebRTCProvider`.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/HasProvider.ts src/client/provider.ts
git commit -m "feat: HasProvider refreshProvider no-op, remove y-sweet debugger URL"
```

---

## Task 8: Full integration smoke-test

**Files:**
- Read-only: plugin build output

- [ ] **Step 1: Build the plugin**

```bash
npm run build
```

Expected: exits 0. If TypeScript errors appear during build that did not appear with `tsc --noEmit`, they indicate a `tsconfig.json` difference — read the error and fix.

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --coverage 2>&1 | tail -40
```

Expected: all tests pass, no regressions.

- [ ] **Step 3: Verify WebRTCProvider satisfies IRelayProvider at the type level**

Open `src/client/webrtc-provider.ts` and confirm the class declaration reads:

```ts
export class WebRTCProvider implements IRelayProvider {
```

If TypeScript compiles without error, the interface contract is satisfied.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: WebRTC provider swap complete — WebRTCProvider replaces YSweetProvider"
```

---

## Known Limitations (not in scope)

- **No encryption**: room name = docId. Non-guessable GUIDs + content-blind signaling provide informal privacy. Add `password` (AES-CBC) when replacing the control plane.
- **Offline peers miss updates**: no persistence on disconnect. Addressed in the Bulletin Chain persistence phase.
- **Signaling is still centralized**: replaced alongside the control plane in the next phase.
- **ICE failure → `'connection-error'`**: y-webrtc does not expose an ICE failure event. The `'connection-error'` mapping is deferred until the signaling layer is replaced.
