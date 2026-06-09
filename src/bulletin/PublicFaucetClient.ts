import type { FaucetResult } from './RelayerClient';

export interface PublicFaucetNetwork {
  endpoint: string;
  parachainId: string;
  symbol: string;
  decimals: number;
}

export class PublicFaucetClient {
  static readonly WESTEND: PublicFaucetNetwork = {
    endpoint: 'https://westend-faucet.polkadot.io/drip/web',
    parachainId: '2487',
    symbol: 'WND',
    decimals: 12,
  };

  static readonly PASEO: PublicFaucetNetwork = {
    endpoint: 'https://paseo-faucet.parity-testnet.parity.io/drip/web',
    parachainId: '5118',
    symbol: 'PAS',
    decimals: 10,
  };

  static forRpcUrl(rpcUrl: string): PublicFaucetNetwork {
    return rpcUrl.toLowerCase().includes('paseo')
      ? PublicFaucetClient.PASEO
      : PublicFaucetClient.WESTEND;
  }

  constructor(
    private readonly address: string,
    private readonly signBytes: (input: Uint8Array) => Promise<Uint8Array>,
    private readonly network: PublicFaucetNetwork,
  ) {}

  async requestFaucetGrant(): Promise<FaucetResult> {
    try {
      const message = `faucet:${this.address}:${Date.now()}`;
      const msgBytes = new TextEncoder().encode(message);
      const sigBytes = await this.signBytes(msgBytes);
      const signature = '0x' + Buffer.from(sigBytes).toString('hex');

      const res = await fetch(this.network.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({
          address: this.address,
          parachain_id: this.network.parachainId,
          signature,
          message,
        }),
      });

      if (!res.ok) return { ok: false, reason: 'faucet_unavailable' };

      const lastLine = await this._readLastNdjsonLine(res);
      if (!lastLine) return { ok: false, reason: 'faucet_unavailable' };

      if (lastLine.hash) return { ok: true, granted: 0n };
      if (typeof lastLine.error === 'string' && lastLine.error.toLowerCase().includes('quota')) {
        return { ok: false, reason: 'rate_limited' };
      }
      return { ok: false, reason: 'faucet_unavailable' };
    } catch {
      return { ok: false, reason: 'network_error' };
    }
  }

  private async _readLastNdjsonLine(res: Response): Promise<Record<string, unknown> | null> {
    const text = await res.text();
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let last: Record<string, unknown> | null = null;
    for (const line of lines) {
      try {
        last = JSON.parse(line);
      } catch {
        // skip malformed lines
      }
    }
    return last;
  }
}
