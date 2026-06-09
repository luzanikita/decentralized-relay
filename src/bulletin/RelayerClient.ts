export type FaucetResult =
  | { ok: true; granted: bigint }
  | { ok: false; reason: 'rate_limited' | 'faucet_unavailable' | 'network_error' };

export type TopUpResult =
  | { ok: true; sent: bigint; remainingBudget: bigint }
  | { ok: false; reason: 'budget_exhausted' | 'inactive' | 'network_error' | 'invalid_token' };

export type StatusResult = {
  status: 'active' | 'past_due' | 'cancelled';
  remainingBudget: bigint;
  periodResetsAt: Date;
};

export class RelayerClient {
  constructor(
    private readonly relayerUrl: string,
    private readonly subscriptionToken?: string,
  ) {}

  async requestFaucetGrant(masterAccount: string, chainNetworkId: string): Promise<FaucetResult> {
    try {
      const res = await fetch(`${this.relayerUrl}/faucet-grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterAccountAddress: masterAccount, chainNetworkId }),
      });
      if (res.status === 429) return { ok: false, reason: 'rate_limited' };
      if (!res.ok) return { ok: false, reason: 'faucet_unavailable' };
      const body = await res.json();
      return { ok: true, granted: BigInt(body.granted) };
    } catch {
      return { ok: false, reason: 'network_error' };
    }
  }

  async topUpNow(): Promise<TopUpResult> {
    if (!this.subscriptionToken) return { ok: false, reason: 'invalid_token' };
    try {
      const res = await fetch(`${this.relayerUrl}/top-up-now`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.subscriptionToken}` },
      });
      if (res.status === 401) return { ok: false, reason: 'invalid_token' };
      if (res.status === 402) return { ok: false, reason: 'inactive' };
      if (res.status === 429) return { ok: false, reason: 'budget_exhausted' };
      if (!res.ok) return { ok: false, reason: 'network_error' };
      const body = await res.json();
      return { ok: true, sent: BigInt(body.sent), remainingBudget: BigInt(body.remainingBudget) };
    } catch {
      return { ok: false, reason: 'network_error' };
    }
  }

  async getStatus(): Promise<StatusResult | null> {
    if (!this.subscriptionToken) return null;
    try {
      const res = await fetch(`${this.relayerUrl}/status`, {
        headers: { Authorization: `Bearer ${this.subscriptionToken}` },
      });
      if (!res.ok) return null;
      const body = await res.json();
      return {
        status: body.status as StatusResult['status'],
        remainingBudget: BigInt(body.remainingBudget),
        periodResetsAt: new Date(body.periodResetsAt),
      };
    } catch {
      return null;
    }
  }
}
