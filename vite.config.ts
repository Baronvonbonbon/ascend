import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: { port: 5180 },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Ascend — a descent to recover the Amulet of Yendor",
        short_name: "Ascend",
        description: "An ASCII fantasy roguelike. Descend to recover the Amulet of Yendor, and ascend.",
        theme_color: "#0b0b0d",
        background_color: "#0b0b0d",
        display: "fullscreen",
        orientation: "landscape",
        start_url: ".",   // relative: the same bundle serves from / on the gateway and /ascend/ on Pages
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The whole game is precached, so a run survives going offline mid-descent. The light
        // client chunk is deliberately excluded — 4 MB nobody who hasn't opted into Pine will use.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["**/chain-lightclient-*.js"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      // pine-rpc's package entry re-exports BOTH the browser-side PineProvider and a Node-side
      // JSON-RPC daemon (node:http, node:crypto, ws) that cannot be bundled for a browser and
      // that we never construct. Resolve the package straight to the provider module instead.
      "pine-rpc": fileURLToPath(new URL("./node_modules/pine-rpc/dist/PineProvider.js", import.meta.url)),
      // Belt and braces: anything else in the light-client tree that reaches for `ws`.
      ws: fileURLToPath(new URL("./src/shims/ws.ts", import.meta.url)),
    },
  },
  build: {
    // The smoldot light client is genuinely ~4 MB and there is nothing to be done about that.
    // It is in its own chunk and only fetched if a player explicitly chooses Pine-RPC, so it
    // never touches the initial load. Warning raised so a real regression in the game chunk shows.
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        // Keep the chain layer out of the initial download. The game must boot — and stay fully
        // playable — with no wallet and no network, so ethers and the smoldot light client are
        // split into their own chunks that only load if the player actually connects.
        manualChunks(id: string) {
          if (id.includes("node_modules/smoldot") || id.includes("node_modules/pine-rpc") || id.includes("@polkadot-api")) return "chain-lightclient";
          if (id.includes("node_modules/ethers") || id.includes("node_modules/@noble") || id.includes("node_modules/@adraffy")) return "chain-ethers";
          return undefined;
        },
      },
    },
  },
});
