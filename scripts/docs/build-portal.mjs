import { build } from 'esbuild';
import { resolve } from 'node:path';
import { demoEngine } from './build-demo.mjs';
import { externalEngine } from './external-engine.mjs';

export async function buildPortal(root, outdir) {
  await build({
    absWorkingDir: root,
    entryPoints: ['docs/react/main.tsx'],
    outfile: resolve(outdir, 'portal.js'),
    bundle: true,
    minify: true,
    jsx: 'automatic',
    format: 'esm',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [demoEngine(root), externalEngine],
    supported: { 'template-literal': false },
    logLevel: 'warning',
  });
}
