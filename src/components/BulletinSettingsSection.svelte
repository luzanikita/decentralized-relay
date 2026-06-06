<script lang="ts">
  import SettingItem from "./SettingItem.svelte";
  import SettingItemHeading from "./SettingItemHeading.svelte";
  import type Live from "src/main";
  import { BulletinClient } from "../bulletin/BulletinClient";

  export let plugin: Live;

  let settings = plugin.bulletinSettings.get();

  function save() {
    plugin.bulletinSettings.update(() => ({ ...settings }));
  }

  function handleEnabledChange(e: Event) {
    settings.bulletinEnabled = (e.target as HTMLInputElement).checked;
    save();
    plugin.bulletinClient?.destroy();
    plugin.bulletinClient = null;
    if (settings.bulletinEnabled && settings.bulletinRpcUrl && settings.bulletinKeyfilePath) {
      plugin.bulletinClient = new BulletinClient(plugin.bulletinSettings.get());
    }
  }

  function handleSignalingUrlsChange(e: Event) {
    settings.signalingUrls = (e.target as HTMLTextAreaElement).value
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    save();
  }

  function handleFallbackTimeoutChange(e: Event) {
    settings.signalingFallbackTimeoutMs =
      Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0) * 1000;
    save();
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
    checked={settings.bulletinEnabled}
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
    bind:value={settings.bulletinRpcUrl}
    on:change={save}
  />
</SettingItem>

<SettingItem
  name="Keyfile path"
  description="Absolute path to your Polkadot.js JSON keyfile export."
>
  <input
    type="text"
    class="text"
    placeholder="/path/to/keyfile.json"
    bind:value={settings.bulletinKeyfilePath}
    on:change={save}
  />
</SettingItem>

<SettingItem
  name="Keyfile password"
  description="Password for the keyfile. Stored in data.json."
>
  <input
    type="password"
    class="text"
    bind:value={settings.bulletinKeyfilePassword}
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
    bind:value={settings.bulletinIpfsGateway}
    on:change={save}
  />
</SettingItem>

<SettingItem
  name="Signaling servers"
  description="WebSocket URLs for peer discovery (one per line). Used when peers connect to the same document."
>
  <textarea
    class="text"
    rows="3"
    style="width: 100%; font-family: monospace; font-size: 12px;"
    on:change={handleSignalingUrlsChange}
  >{settings.signalingUrls.join('\n')}</textarea>
</SettingItem>

{#if settings.bulletinEnabled}
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
