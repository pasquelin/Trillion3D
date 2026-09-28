import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { exampleModules } from './docs/examples/capture.ts';

const root = new URL('../', import.meta.url);
const examples = new URL('site/examples/', root);

/** The names each runtime module exports, read from its bundle as `build-runtime.ts` makes it. */
async function runtimeExports(): Promise<Record<'engine' | 'kit', Set<string>>> {
  const { metafile } = await build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: {
      engine: 'packages/sdk-browser/src/index.ts',
      kit: 'site/examples/kit/index.ts',
    },
    outdir: 'out',
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  });
  const names = (entry: string) =>
    new Set(
      Object.values(metafile.outputs).find(({ entryPoint }) => entryPoint === entry)?.exports,
    );
  return {
    engine: names('packages/sdk-browser/src/index.ts'),
    kit: names('site/examples/kit/index.ts'),
  };
}

test('every name an example imports from the runtime is one it exports (#945)', async () => {
  // `banner`, gone from the kit with #327, left inside-a-component unable to load: a module that
  // imports a missing name fails before its first line runs, on every backend.
  const exported = await runtimeExports();
  assert.ok(exported.engine.has('createWorld') && exported.kit.has('controls'));
  const missing: string[] = [];
  for (const file of (await readdir(examples)).filter((name) => name.endsWith('.html')))
    for (const source of await exampleModules(await readFile(new URL(file, examples), 'utf8')))
      for (const [, names, module] of source.matchAll(
        /import \{([^}]*)\} from '\.\.\/runtime\/(engine|kit)\.js'/g,
      ))
        for (const name of names.split(',').map((one) => one.trim().split(/\s+as\s+/)[0]))
          if (name && !exported[module as 'engine' | 'kit'].has(name.replace(/^type\s+/, '')))
            missing.push(`${file}: ${name} from ${module}.js`);
  assert.deepEqual(missing, []);
});
