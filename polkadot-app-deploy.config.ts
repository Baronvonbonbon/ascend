// Product manifest for deploying Ascend to the Polkadot Bulletin Chain under a `.dot` name.
//
//   npm run build:bulletin        # produces dist/ with base "/"
//   npm run deploy:bulletin       # uploads it and points the .dot name at the new CID
//
// Requires Node >= 22. See DEPLOY.md for the name registration + storage authorization steps,
// and for why a scheduled re-deploy exists (Bulletin data expires unless renewed).
//
// NOTE: the icon must be PNG or JPEG — the manifest schema does not accept SVG, which is why
// public/icon-512.png is generated alongside public/icon.svg.

import { defineConfig } from "@polkadot-community-foundation/polkadot-app-deploy";

export default defineConfig({
  domain: "ascendyendor00.dot",
  displayName: "Ascend",
  description: "An ASCII fantasy roguelike. Descend to recover the Amulet of Yendor, and ascend.",
  icon: { path: "public/icon-512.png", format: "png" },
  executables: [
    { kind: "app", path: "dist", appVersion: [0, 1, 0] },
  ],
});
