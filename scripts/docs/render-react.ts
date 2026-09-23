import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { externalEngine, PROGRAM_TEXT } from './external-engine.ts';

/** Compile maintained TSX for server-rendered component contract tests. */
export async function loadReactComponents(relativePath: string): Promise<Record<string, unknown>> {
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
    plugins: [externalEngine],
    loader: PROGRAM_TEXT,
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
