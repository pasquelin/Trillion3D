import { build } from 'esbuild';
import { externalEngine, PROGRAM_TEXT } from './external-engine.ts';

/**
 * Bundles the React portal, `site/app/main.tsx`, as `portal.js` in `outdir`, with the areas the
 * app imports on demand (`App.tsx`) as chunks beside it.
 */
export async function buildPortal(root: string, outdir: string) {
  await build({
    absWorkingDir: root,
    entryPoints: { portal: 'site/app/main.tsx' },
    outdir,
    chunkNames: 'portal-[hash]',
    splitting: true,
    bundle: true,
    minify: true,
    jsx: 'automatic',
    format: 'esm',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [externalEngine],
    loader: PROGRAM_TEXT,
    supported: { 'template-literal': false },
    logLevel: 'warning',
  });
}
