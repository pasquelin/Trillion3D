import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { RUNTIME_ENTRIES } from './docs/build-runtime.ts';
import { exampleModules, RUNTIME_IMPORT } from './docs/examples/capture.ts';
import { examplePages } from './docs/examples/pages.ts';

type Runtime = keyof typeof RUNTIME_ENTRIES;

/** The names each runtime module exports, read from its bundle as `build-runtime.ts` makes it. */
async function runtimeExports(): Promise<Record<Runtime, Set<string>>> {
  const { metafile } = await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: RUNTIME_ENTRIES,
    outdir: 'out',
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
  });
  const outputs = Object.values(metafile.outputs);
  const names = (entry: string) =>
    new Set(outputs.find(({ entryPoint }) => entryPoint === entry)?.exports);
  return { engine: names(RUNTIME_ENTRIES.engine), kit: names(RUNTIME_ENTRIES.kit) };
}

test('every name an example imports from the runtime is one it exports (#945)', async () => {
  // `banner`, gone from the kit with #327, left inside-a-component unable to load: a module that
  // imports a missing name fails before its first line runs, on every backend.
  const [exported, pages] = await Promise.all([runtimeExports(), examplePages()]);
  assert.ok(exported.engine.has('createWorld') && exported.kit.has('controls'));
  const sources = await Promise.all(
    pages.map(async ({ file, html }) => ({ file, modules: await exampleModules(html) })),
  );
  const missing = sources.flatMap(({ file, modules }) =>
    modules.flatMap((source) =>
      [...source.matchAll(RUNTIME_IMPORT)].flatMap(([, names, module]) =>
        names
          .split(',')
          .map((one) => one.trim().split(/\s+as\s+/)[0])
          .filter((name) => name && !exported[module as Runtime].has(name))
          .map((name) => `${file}: ${name} from ${module}.js`),
      ),
    ),
  );
  assert.deepEqual(missing, []);
});
