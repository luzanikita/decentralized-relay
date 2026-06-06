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
