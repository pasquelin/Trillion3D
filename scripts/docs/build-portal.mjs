import { build } from 'esbuild';
import { resolve } from 'node:path';

export async function buildPortal(root, outdir = resolve(root, 'docs/runtime')) {
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
    plugins: [
      {
        name: 'external-engine-runtime',
        setup(bundler) {
          bundler.onResolve({ filter: /runtime\/engine\.js$/ }, () => ({
            path: './engine.js',
            external: true,
          }));
        },
      },
    ],
    supported: { 'template-literal': false },
    logLevel: 'warning',
  });
}
