<script lang="ts">
  import SettingItem from "./SettingItem.svelte";
  import SettingItemHeading from "./SettingItemHeading.svelte";
  import type Live from "src/main";

  export let plugin: Live;

  let settings = plugin.bulletinSettings.get();
  let passkeySettings = plugin.passkeySettings.get();
  let isLoading = false;
  let error = '';

  const safeStorage = (() => {
    try { return require('electron').safeStorage; } catch { return null; }
  })();

  $: safeStorageAvailable = safeStorage?.isEncryptionAvailable?.() ?? false;
  $: hasPasskey = !!passkeySettings.credentialId;
  $: hasDeviceKey = !!passkeySettings.deviceKeyEncrypted;

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
      await plugin.assetHubClient.removeProxy(passkeySettings.deviceAccountId, masterSigner);
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

<SettingItem
  name="RPC URL"
  description="WebSocket URL for the bulletin-westend node."
>
  <input
    type="text"
    class="text"
    placeholder="wss://..."
    bind:value={settings.rpcUrl}
    on:change={save}
  />
</SettingItem>

<SettingItem
  name="Asset Hub RPC URL"
  description="WebSocket URL for the westend Asset Hub node (used for proxy registration)."
>
  <input
    type="text"
    class="text"
    placeholder="wss://westend-asset-hub-rpc.polkadot.io"
    bind:value={settings.assetHubRpcUrl}
    on:change={save}
  />
</SettingItem>

<SettingItem
  name="IPFS gateway"
  description="HTTP gateway for fetching snapshots by CID."
>
  <input
    type="text"
    class="text"
    bind:value={settings.ipfsGateway}
    on:change={save}
  />
</SettingItem>

<SettingItem
  name="Signaling servers"
  description="WebSocket URLs for peer discovery (one per line)."
>
  <textarea
    class="text"
    rows="3"
    style="width: 100%; font-family: monospace; font-size: 12px;"
    on:change={handleSignalingUrlsChange}
  >{settings.signalingUrls.join('\n')}</textarea>
</SettingItem>

{#if settings.enabled}
<SettingItem
  name="Signaling fallback timeout (seconds)"
  description="Seconds to wait for a peer via public signaling before falling back to Bulletin Chain. 0 = disabled."
>
  <input
    type="number"
    class="text"
    min="0"
    max="60"
    style="width: 60px;"
    value={Math.round(settings.signalingFallbackTimeoutMs / 1000)}
    on:change={handleFallbackTimeoutChange}
  />
</SettingItem>
{/if}

<SettingItemHeading name="Polkadot Identity" />

{#if !safeStorageAvailable}
  <div class="setting-item mod-warning">
    OS secure storage unavailable. Passkey identity requires Electron safeStorage.
  </div>
{:else if !hasPasskey}
  <SettingItem
    name="Register Passkey"
    description="Create a passkey-derived Polkadot identity. Passkey identity uses a different on-chain account than keyfile identity — transfer any tokens from your old account via Polkadot-JS Apps before switching."
  >
    <button class="mod-cta" disabled={isLoading} on:click={handleRegisterPasskey}>
      {isLoading ? 'Setting up…' : 'Register Passkey'}
    </button>
  </SettingItem>
{:else if hasPasskey && !hasDeviceKey}
  <SettingItem
    name="Master account"
    description="Your permanent passkey-derived identity (never stored)."
  >
    <code style="font-size: 11px;">{passkeySettings.masterAccountId ?? '—'}</code>
  </SettingItem>
  <SettingItem name="Set up device key" description="Register this device as a proxy of your master account.">
    <button class="mod-cta" disabled={isLoading} on:click={handleRegisterPasskey}>
      {isLoading ? 'Registering…' : 'Setup device key'}
    </button>
  </SettingItem>
{:else}
  <SettingItem
    name="Master account"
    description="Your permanent passkey-derived identity."
  >
    <code style="font-size: 11px;">{passkeySettings.masterAccountId}</code>
  </SettingItem>
  <SettingItem
    name="Device account"
    description="This device's signing key, registered as a proxy of your master account."
  >
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
