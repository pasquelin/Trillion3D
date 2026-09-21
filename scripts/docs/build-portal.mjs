import { build } from 'esbuild';
import { resolve } from 'node:path';
import { externalEngine } from './external-engine.mjs';

/** Bundles the React portal, `site/app/main.tsx`, as `portal.js` in `outdir`. */
export async function buildPortal(root, outdir) {
  await build({
    absWorkingDir: root,
    entryPoints: ['site/app/main.tsx'],
    outfile: resolve(outdir, 'portal.js'),
    bundle: true,
    minify: true,
    jsx: 'automatic',
    format: 'esm',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [externalEngine],
    supported: { 'template-literal': false },
    logLevel: 'warning',
  });
}
