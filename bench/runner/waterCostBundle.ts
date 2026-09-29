import { build } from 'esbuild';
import { resolve } from 'node:path';

export async function waterCostBundle(fixtureRoot: string, engineRoot: string) {
  // The fixture is fixed; only the backend entry changes when comparing two local issue worktrees.
  const pageModule = resolve(fixtureRoot, 'tests/browser/support/waterCostPage.ts');
  const backendModule = resolve(engineRoot, 'packages/sdk-browser/src/webgpu/pages/pages.ts');
  const codec = resolve(engineRoot, 'packages/sdk-browser/src/page/decode/geometryPageWasm.ts');
  const wasm = resolve(engineRoot, 'packages/sdk-browser/src/page/decode/pageCodec.wasm');
  return (
    await build({
      stdin: {
        contents: `import { run as measure } from ${JSON.stringify(pageModule)};
import { webgpuPagesBackend } from ${JSON.stringify(backendModule)};
import { prepareSdkWasm } from ${JSON.stringify(codec)};
import bytes from ${JSON.stringify(wasm)};
export const run = async options => {
  if (!await prepareSdkWasm(bytes)) throw new Error('SDK WASM preload failed');
  return measure(webgpuPagesBackend, options);
};`,
        resolveDir: fixtureRoot,
        loader: 'ts',
      },
      loader: { '.wasm': 'binary' },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'waterCost',
      platform: 'browser',
      target: 'es2022',
      logLevel: 'error',
    })
  ).outputFiles[0].text;
}
