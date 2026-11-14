// Bundles the browser app into public/build and self-hosts the barcode decoder's .wasm.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const outdir = "public/build";
const watch = process.argv.includes("--watch");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// zxing-wasm's reader binary (used only when the browser lacks native BarcodeDetector).
copyFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm"), join(outdir, "zxing_reader.wasm"));

// Version info shown in the page footer.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const git = (cmd) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
// Cloudflare Workers Builds exposes the commit SHA in the environment; locally we ask git.
const sha = (process.env.WORKERS_CI_COMMIT_SHA || git("git rev-parse HEAD")).slice(0, 7);
const dirty = !process.env.WORKERS_CI_COMMIT_SHA && sha && git("git status --porcelain") ? "+dirty" : "";
const buildInfo = {
  version: pkg.version,
  build: sha ? sha + dirty : "dev",
  date: new Date().toISOString(),
};
console.log(`Build info: v${buildInfo.version} build ${buildInfo.build} ${buildInfo.date}`);

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
  define: {
    __APP_VERSION__: JSON.stringify(buildInfo.version),
    __BUILD_ID__: JSON.stringify(buildInfo.build),
    __BUILD_DATE__: JSON.stringify(buildInfo.date),
  },
};

if (watch) {
  const { context } = await import("esbuild");
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
