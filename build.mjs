// Build / dev-server script for spark-charts.
//   node build.mjs           -> bundle the examples demo to examples/app.js
//   node build.mjs --serve   -> watch + serve the examples folder on :5173
//   node build.mjs --lib     -> bundle the library to dist/index.js (ESM)
import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const common = {
  bundle: true,
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

if (args.has('--lib')) {
  rmSync('dist', { recursive: true, force: true });
  await esbuild.build({
    ...common,
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    minify: false,
  });
  console.log('Built library -> dist/index.js');
  process.exit(0);
}

const ctx = await esbuild.context({
  ...common,
  entryPoints: ['examples/demo.ts'],
  outfile: 'examples/app.js',
});

if (args.has('--serve')) {
  await ctx.watch();
  const server = await ctx.serve({ servedir: 'examples', host: '127.0.0.1', port: 5173 });
  console.log(`\n  spark-charts demo running at  http://${server.host}:${server.port}/\n`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('Built demo -> examples/app.js');
}
