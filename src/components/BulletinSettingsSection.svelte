<script lang="ts">
  import SettingItem from "./SettingItem.svelte";
  import SettingItemHeading from "./SettingItemHeading.svelte";
  import { onDestroy } from "svelte";
  import type Live from "src/main";
  import type { SharedFolder } from "src/SharedFolder";
  import type { JoinRequest } from "src/acl/JoinRequestMonitor";
  import type { FolderMember } from "src/asset-hub/types";

  export let plugin: Live;

  let settings = plugin.bulletinSettings.get();
  let passkeySettings = plugin.passkeySettings.get();
  let isLoading = false;
  let error = '';

  // Gas management state
  let cachedBalance: bigint | null = null;
  let relayerStatus: import('src/bulletin/RelayerClient').StatusResult | null = null;
  let gasLoading = false;
  let gasMessage = '';

  $: tier = settings.subscriptionToken ? 'paid' : 'free';
  $: relayerConfigured = !!settings.relayerUrl;

  function formatPlanck(planck: bigint): string {
    // WND has 12 decimal places; display with 4 decimal places
    const whole = planck / 1_000_000_000_000n;
    const frac = ((planck % 1_000_000_000_000n) * 10000n) / 1_000_000_000_000n;
    return `${whole}.${frac.toString().padStart(4, '0')} WND`;
  }

  async function refreshBalance() {
    if (!plugin.bulletinClient) return;
    try {
      cachedBalance = await plugin.bulletinClient.getBalance();
    } catch { /* non-fatal */ }
  }

  async function refreshStatus() {
    if (!plugin.relayerClient) return;
    try {
      relayerStatus = await plugin.relayerClient.getStatus();
    } catch { /* non-fatal */ }
  }

  async function handleRequestFaucetGrant() {
    if (!plugin.relayerClient) return;
    const masterAccount = passkeySettings.masterAccountId;
    if (!masterAccount) { gasMessage = 'Register a passkey first.'; return; }
    gasLoading = true;
    gasMessage = '';
    try {
      const result = await plugin.relayerClient.requestFaucetGrant(masterAccount, 'bulletin-westend');
      if (result.ok) {
        gasMessage = "Account funded — you're ready to use Bulletin Chain persistence.";
        await refreshBalance();
      } else if (result.reason === 'rate_limited') {
        gasMessage = 'Already granted — testnet tokens cover months of usage. Check back in 30 days.';
      } else {
        gasMessage = 'Faucet unavailable — try again later.';
      }
    } finally {
      gasLoading = false;
    }
  }

  async function handleActivatePaid() {
    gasLoading = true;
    gasMessage = '';
    try {
      await refreshStatus();
      await refreshBalance();
      if (relayerStatus?.status === 'active') {
        gasMessage = 'Subscription active.';
      } else if (relayerStatus) {
        gasMessage = `Subscription status: ${relayerStatus.status}`;
      } else {
        gasMessage = 'Could not reach relayer — check URL and token.';
      }
    } finally {
      gasLoading = false;
    }
  }

  // Per-folder ACL state
  let folderMembers: Record<string, FolderMember[]> = {};
  let folderMemberError: Record<string, string> = {};
  let pendingRequests: JoinRequest[] = [];

  const unsubPending = plugin.pendingJoinRequests.subscribe((reqs) => {
    pendingRequests = reqs;
  });
  onDestroy(unsubPending);

  const safeStorage = (() => {
    try { return require('electron').safeStorage; } catch { return null; }
  })();

  $: safeStorageAvailable = safeStorage?.isEncryptionAvailable?.() ?? false;
  $: hasPasskey = !!passkeySettings.credentialId;
  $: hasDeviceKey = !!passkeySettings.deviceKeyEncrypted;
  $: sharedFolders = plugin.sharedFolders ? [...plugin.sharedFolders] : [];
  $: controlPlaneEnabled = settings.controlPlaneEnabled;

  function save() {
    plugin.bulletinSettings.update(() => ({ ...settings }));
  }

  function handleEnabledChange(e: Event) {
    settings.enabled = (e.target as HTMLInputElement).checked;
    save();
    plugin.bulletinClient?.destroy();
    plugin.bulletinClient = null;
  }

  function handleSignalingUrlsChange(e: Event) {
    settings.signalingUrls = (e.target as HTMLTextAreaElement).value
      .split('\n').map(u => u.trim()).filter(u => u.length > 0);
    save();
  }

  function handleFallbackTimeoutChange(e: Event) {
    settings.signalingFallbackTimeoutMs =
      Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0) * 1000;
    save();
  }

  async function handleRegisterPasskey() {
    if (!plugin.passkeyIdentity) return;
    isLoading = true;
    error = '';
    try {
      await plugin.passkeyIdentity.register();
      const masterSigner = await plugin.passkeyIdentity.getMasterSigner();
      await plugin.passkeyIdentity.setupDeviceKey(masterSigner);
      passkeySettings = plugin.passkeySettings.get();
    } catch (e: any) {
      error = e?.message ?? 'Passkey setup failed';
    } finally {
      isLoading = false;
    }
  }

  async function handleRevokeDevice() {
    if (!plugin.passkeyIdentity || !passkeySettings.deviceAccountId) return;
    isLoading = true;
    error = '';
    try {
      const masterSigner = await plugin.passkeyIdentity.getMasterSigner();
      await plugin.assetHubClient!.removeProxy(passkeySettings.deviceAccountId, masterSigner);
      plugin.passkeySettings.update(() => ({
        ...passkeySettings,
        deviceKeyEncrypted: null,
        deviceAccountId: null,
      }));
      passkeySettings = plugin.passkeySettings.get();
    } catch (e: any) {
      error = e?.message ?? 'Revocation failed';
    } finally {
      isLoading = false;
    }
  }

  async function handleSetupFolderACL(folder: SharedFolder) {
    if (!plugin.passkeyIdentity) return;
    isLoading = true;
    error = '';
    try {
      const address = await plugin.passkeyIdentity.setupFolderAccount(folder.guid);
      folder.updateFolderAccountAddress(address);
      sharedFolders = [...plugin.sharedFolders];
    } catch (e: any) {
      error = e?.message ?? 'Folder account setup failed';
    } finally {
      isLoading = false;
    }
  }

  async function handleGenerateInvite(folder: SharedFolder, role: 'full' | 'read-only') {
    if (!plugin.passkeyIdentity || !folder.folderAccountAddress) return;
    isLoading = true;
    error = '';
    try {
      const code = await plugin.passkeyIdentity.generateInvite(
        folder.guid, folder.folderAccountAddress, role,
      );
      await navigator.clipboard.writeText(code);
      new (require('obsidian').Notice)('Invite code copied to clipboard');
    } catch (e: any) {
      error = e?.message ?? 'Invite generation failed';
    } finally {
      isLoading = false;
    }
  }

  async function loadMembers(folder: SharedFolder) {
    if (!plugin.assetHubClient || !folder.folderAccountAddress) return;
    try {
      folderMembers[folder.guid] = await plugin.assetHubClient.getFolderMembers(folder.folderAccountAddress);
      folderMembers = { ...folderMembers };
    } catch (e: any) {
      folderMemberError[folder.guid] = e?.message ?? 'Failed to load members';
    }
  }

  async function handleRevokeMember(folder: SharedFolder, member: FolderMember) {
    if (!plugin.passkeyIdentity || !folder.folderAccountAddress) return;
    isLoading = true;
    error = '';
    try {
      const folderSigner = await plugin.passkeyIdentity.getFolderAccountSigner(folder.guid);
      await plugin.assetHubClient!.removeFolderMember(folder.folderAccountAddress, member.masterAccount, member.role, folderSigner);
      await loadMembers(folder);
    } catch (e: any) {
      error = e?.message ?? 'Revocation failed';
    } finally {
      isLoading = false;
    }
  }

  async function handleApproveJoinRequest(req: JoinRequest) {
    if (!plugin.passkeyIdentity || !plugin.assetHubClient) return;
    const { decodeInvite } = await import('src/acl/InviteCode');
    const invite = decodeInvite(req.invite);
    isLoading = true;
    error = '';
    try {
      const folderSigner = await plugin.passkeyIdentity.getFolderAccountSigner(req.folderId);
      await plugin.assetHubClient.addFolderMember(
        req.folderAccountAddress, req.requesterMaster, invite.role, folderSigner,
      );
      plugin.pendingJoinRequests.update((list) => list.filter((r) => r !== req));
    } catch (e: any) {
      error = e?.message ?? 'Approval failed';
    } finally {
      isLoading = false;
    }
  }

  function handleDenyJoinRequest(req: JoinRequest) {
    plugin.pendingJoinRequests.update((list) => list.filter((r) => r !== req));
  }

  function explorerUrl(address: string): string {
    return `https://westend.subscan.io/account/${address}`;
  }
</script>

<SettingItemHeading name="Bulletin Chain (Experimental)" />

<SettingItem
  name="Enable Bulletin Chain backup"
  description="Snapshot documents to the Polkadot Bulletin Chain testnet for offline recovery."
>
  <input
    type="checkbox"
    class="checkbox"
    checked={settings.enabled}
    on:change={handleEnabledChange}
  />
</SettingItem>

<SettingItem name="RPC URL" description="WebSocket URL for the bulletin-westend node.">
  <input type="text" class="text" placeholder="wss://..." bind:value={settings.rpcUrl} on:change={save} />
</SettingItem>

<SettingItem name="Asset Hub RPC URL" description="WebSocket URL for the westend Asset Hub node.">
  <input type="text" class="text" placeholder="wss://westend-asset-hub-rpc.polkadot.io" bind:value={settings.assetHubRpcUrl} on:change={save} />
</SettingItem>

<SettingItem name="IPFS gateway" description="HTTP gateway for fetching snapshots by CID.">
  <input type="text" class="text" bind:value={settings.ipfsGateway} on:change={save} />
</SettingItem>

<SettingItem name="Signaling servers" description="WebSocket URLs for peer discovery (one per line).">
  <textarea class="text" rows="3" style="width: 100%; font-family: monospace; font-size: 12px;"
    on:change={handleSignalingUrlsChange}>{settings.signalingUrls.join('\n')}</textarea>
</SettingItem>

{#if settings.enabled}
<SettingItem name="Signaling fallback timeout (seconds)" description="Seconds to wait before falling back to Bulletin Chain. 0 = disabled.">
  <input type="number" class="text" min="0" max="60" style="width: 60px;"
    value={Math.round(settings.signalingFallbackTimeoutMs / 1000)}
    on:change={handleFallbackTimeoutChange} />
</SettingItem>
{/if}

<!-- Per-folder ACL -->
{#if controlPlaneEnabled && hasPasskey && hasDeviceKey}
  <SettingItemHeading name="Folder Access Control" />

  {#each sharedFolders as folder (folder.guid)}
    {@const addr = folder.folderAccountAddress}
    {@const members = folderMembers[folder.guid] ?? []}
    {@const pendingForFolder = pendingRequests.filter(r => r.folderId === folder.guid)}

    <div style="margin: 8px 0; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 6px;">
      <strong style="font-size: 13px;">{folder.path}</strong>

      {#if !addr}
        <SettingItem name="Enable on-chain ACL" description="Create a folder account to manage membership on Asset Hub.">
          <button class="mod-cta" disabled={isLoading} on:click={() => handleSetupFolderACL(folder)}>
            {isLoading ? 'Setting up…' : 'Enable ACL'}
          </button>
        </SettingItem>
      {:else}
        <SettingItem name="Folder account" description="Fund this account before inviting members.">
          <a href={explorerUrl(addr)} target="_blank" rel="noreferrer">
            <code style="font-size: 11px;">{addr.slice(0, 12)}…</code>
          </a>
        </SettingItem>

        <SettingItem name="Invite member" description="Generate an invite code (full access).">
          <button disabled={isLoading} on:click={() => handleGenerateInvite(folder, 'full')}>Full</button>
          <button disabled={isLoading} on:click={() => handleGenerateInvite(folder, 'read-only')}>Read-only</button>
        </SettingItem>

        <SettingItem name="Members" description="Current proxies on Asset Hub.">
          <button disabled={isLoading} on:click={() => loadMembers(folder)}>Refresh</button>
        </SettingItem>

        {#each members as member}
          <SettingItem name={member.role} description={member.masterAccount}>
            <button class="mod-warning" disabled={isLoading}
              on:click={() => handleRevokeMember(folder, member)}>Revoke</button>
          </SettingItem>
        {/each}

        {#each pendingForFolder as req}
          <div class="setting-item" style="background: var(--background-modifier-success-hover); border-radius: 4px; padding: 6px 8px;">
            <span>{req.requesterMaster.slice(0, 12)}… wants to join as
              {(() => { try { const { decodeInvite } = require('src/acl/InviteCode'); return decodeInvite(req.invite).role; } catch { return '?'; } })()}.
            </span>
            <button class="mod-cta" disabled={isLoading} on:click={() => handleApproveJoinRequest(req)}>Approve</button>
            <button disabled={isLoading} on:click={() => handleDenyJoinRequest(req)}>Deny</button>
          </div>
        {/each}
      {/if}
    </div>
  {/each}
{/if}

<!-- Chain Token Balance -->
{#if settings.enabled && hasPasskey && hasDeviceKey}
  <SettingItemHeading name="Chain Token Balance" />

  {#if cachedBalance !== null}
    <SettingItem name="Device account balance" description="Chain tokens available to pay transaction fees.">
      <code style="font-size: 12px;">{formatPlanck(cachedBalance)}</code>
      <button on:click={refreshBalance} disabled={gasLoading} style="margin-left: 6px;">Refresh</button>
    </SettingItem>
  {:else}
    <SettingItem name="Balance" description="Check how many tokens are available for fees.">
      <button on:click={refreshBalance} disabled={gasLoading}>Check balance</button>
    </SettingItem>
  {/if}

  {#if tier === 'free'}
    <SettingItemHeading name="Free Tier — Testnet Tokens" />
    <SettingItem
      name="Get free tokens"
      description="Fund your device account from the Westend testnet faucet. One grant per 30 days. No account or payment required."
    >
      <button class="mod-cta" disabled={gasLoading || !relayerConfigured} on:click={handleRequestFaucetGrant}>
        {gasLoading ? 'Requesting…' : 'Get free tokens'}
      </button>
    </SettingItem>
    {#if !relayerConfigured}
      <div class="setting-item" style="color: var(--text-muted); font-size: 12px;">
        Set a Relayer URL below to use the free faucet.
      </div>
    {/if}
  {:else}
    <SettingItemHeading name="Paid Subscription" />
    <SettingItem name="Verify subscription" description="Check status and seed initial balance.">
      <button class="mod-cta" disabled={gasLoading} on:click={handleActivatePaid}>
        {gasLoading ? 'Checking…' : 'Verify'}
      </button>
    </SettingItem>
    {#if relayerStatus}
      {#if relayerStatus.status === 'active'}
        <SettingItem name="Status" description={`Period resets ${relayerStatus.periodResetsAt.toLocaleDateString()}`}>
          <span style="color: var(--color-green);">Active</span>
        </SettingItem>
        <SettingItem name="Remaining budget" description="Budget for automatic top-ups this period.">
          <code style="font-size: 12px;">{formatPlanck(relayerStatus.remainingBudget)}</code>
        </SettingItem>
      {:else if relayerStatus.status === 'past_due'}
        <div class="setting-item mod-warning">Payment past due — update your payment method at the subscription portal.</div>
      {:else}
        <div class="setting-item mod-warning">Subscription inactive. Renew to re-enable automatic top-ups.</div>
      {/if}
    {/if}
  {/if}

  {#if gasMessage}
    <div class="setting-item" style="color: var(--text-muted); font-size: 12px; padding: 4px 0;">{gasMessage}</div>
  {/if}

  <SettingItemHeading name="Relayer Configuration" />

  <SettingItem name="Relayer URL" description="HTTPS URL of the gas relayer backend (e.g. https://relay.yourdomain.com).">
    <input type="text" class="text" placeholder="https://relay.yourdomain.com"
      bind:value={settings.relayerUrl} on:change={save} />
  </SettingItem>

  <SettingItem
    name="Subscription token"
    description="Bearer token from your subscription portal. Leave empty to stay on the free tier."
  >
    <input type="password" class="text" placeholder="Leave empty for free tier"
      bind:value={settings.subscriptionToken} on:change={save} />
  </SettingItem>

  <SettingItem
    name="Low balance threshold (WND)"
    description="Paid top-up triggers when the device account drops below this amount."
  >
    <input
      type="number"
      class="text"
      min="0"
      step="0.1"
      style="width: 80px;"
      value={settings.lowBalanceThreshold / 1_000_000_000_000}
      on:change={(e) => {
        const wnd = parseFloat((e.target as HTMLInputElement).value) || 0;
        settings.lowBalanceThreshold = Math.max(0, Math.round(wnd * 1_000_000_000_000));
        save();
      }}
    />
    <span style="margin-left: 4px; color: var(--text-muted);">WND</span>
  </SettingItem>
{/if}

<!-- Passkey Identity -->
<SettingItemHeading name="Polkadot Identity" />

{#if !safeStorageAvailable}
  <div class="setting-item mod-warning">
    OS secure storage unavailable. Passkey identity requires Electron safeStorage.
  </div>
{:else if !hasPasskey}
  <SettingItem
    name="Register Passkey"
    description="Create a passkey-derived Polkadot identity."
  >
    <button class="mod-cta" disabled={isLoading} on:click={handleRegisterPasskey}>
      {isLoading ? 'Setting up…' : 'Register Passkey'}
    </button>
  </SettingItem>
{:else if hasPasskey && !hasDeviceKey}
  <SettingItem name="Master account" description="Your permanent passkey-derived identity (never stored).">
    <code style="font-size: 11px;">{passkeySettings.masterAccountId ?? '—'}</code>
  </SettingItem>
  <SettingItem name="Set up device key" description="Register this device as a proxy of your master account.">
    <button class="mod-cta" disabled={isLoading} on:click={handleRegisterPasskey}>
      {isLoading ? 'Registering…' : 'Setup device key'}
    </button>
  </SettingItem>
{:else}
  <SettingItem name="Master account" description="Your permanent passkey-derived identity.">
    <code style="font-size: 11px;">{passkeySettings.masterAccountId}</code>
  </SettingItem>
  <SettingItem name="Device account" description="This device's signing key, registered as a proxy of your master account.">
    <code style="font-size: 11px;">{passkeySettings.deviceAccountId}</code>
  </SettingItem>
  <SettingItem name="Revoke this device" description="Removes this device key from your master account's proxy list.">
    <button class="mod-warning" disabled={isLoading} on:click={handleRevokeDevice}>
      {isLoading ? 'Revoking…' : 'Revoke this device'}
    </button>
  </SettingItem>
{/if}

{#if error}
  <div class="setting-item mod-warning">{error}</div>
{/if}
