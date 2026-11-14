// Bundles the browser app into public/build and self-hosts the barcode decoder's .wasm.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const outdir = "public/build";
const watch = process.argv.includes("--watch");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// zxing-wasm's reader binary (used only when the browser lacks native BarcodeDetector).
copyFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"), join(outdir, "zxing_reader.wasm"));

const options = {
  entryPoints: ["src/client/main.tsx"],
  outdir,
  bundle: true,
  format: "esm",
  splitting: true, // the scanner fallback is loaded on demand
  minify: !watch,
  sourcemap: true,
  target: ["es2020", "safari15", "chrome100"],
  jsx: "automatic",
  jsxImportSource: "preact",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  logLevel: "info",
};

if (watch) {
  const { context } = await import("esbuild");
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
