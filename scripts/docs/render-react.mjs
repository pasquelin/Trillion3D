import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { demoEngine } from './build-demo.mjs';
import { externalEngine } from './external-engine.mjs';

/** Compile maintained JSX for server-rendered component contract tests. */
export async function loadReactComponents(relativePath) {
  const root = resolve(import.meta.dirname, '../..');
  const output = await build({
    absWorkingDir: root,
    entryPoints: [relativePath],
    bundle: true,
    write: false,
    jsx: 'automatic',
    format: 'cjs',
    platform: 'node',
    packages: 'external',
    plugins: [demoEngine(root), externalEngine],
    logLevel: 'silent',
  });
  const module = { exports: {} };
  const require = createRequire(resolve(root, relativePath));
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  return module.exports;
}
