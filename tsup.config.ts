import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    node: "src/node.ts",
    protocol: "src/protocol.ts",
    x402: "src/x402.ts",
    verify: "src/verify.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  splitting: true,
  // The Node entry reads the identity file. Everything else runs wherever fetch and WebCrypto exist.
  external: [/^node:/, /^viem($|\/)/],
});
