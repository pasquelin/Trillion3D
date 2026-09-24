import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Metafile } from 'esbuild';
import {
  proveBundledInstalledBrowser as runBundledBrowser,
  proveInstalledBrowser,
} from './installed-package-browser-modes.ts';
import type { InstalledBrowserProof } from './installed-package-browser-result.ts';
import type { Run } from './installed-package-contracts.ts';

const sceneCaches = ['native-cache-primer', 'native-cache-replay'];

interface BundleAsset {
  path: string;
  size: number;
}

function filesAt(root: string, directory = root): BundleAsset[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesAt(root, path)
      : [{ path: path.slice(root.length + 1), size: statSync(path).size }];
  });
}

/** The chunk that starts the physics (it names Jolt's module) finds its worker and both modules
 *  beside it. */
function checkPhysicsBeside(outputRoot: string, assets: BundleAsset[]) {
  const starts = assets.filter(
    ({ path }) =>
      path.endsWith('.js') &&
      readFileSync(join(outputRoot, path), 'utf8').includes('joltPhysics.wasm'),
  );
  if (!starts.length) throw new Error('browser bundle has no chunk that starts the physics');
  for (const { path } of starts)
    for (const beside of ['physicsWorker.js', 'joltPhysics.wasm', 'joltPhysicsThreads.wasm'])
      if (!assets.some((asset) => asset.path === join(dirname(path), beside)))
        throw new Error(`browser bundle: ${path} does not find ${beside} beside it`);
}

interface EmittedBrowserBundle {
  outputRoot: string;
  assets: BundleAsset[];
  metafile: Metafile;
}

interface BrowserModesOptions {
  fixture: string;
  packageName: string;
  browserEntry: string;
  bundler: string;
  run: Run;
}

function emitInstalledBrowserBundle({
  fixture,
  packageName,
  bundler,
  run,
}: BrowserModesOptions): EmittedBrowserBundle {
  const outputRoot = join(fixture, 'browser-output');
  const packageRoot = join(fixture, 'node_modules', packageName);
  const decodeRoot = join(packageRoot, 'dist/sdk-browser/src/page/decode');
  const integrationRoot = join(packageRoot, 'dist/sdk-browser/src/page/integration');
  const physicsRoot = join(packageRoot, 'dist/sdk-browser/src/physics');
  const explorer = join(fixture, 'explorer.ts');
  const metafile = join(outputRoot, 'metafile.json');
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(
    explorer,
    `import { createWorld,pose,metric,capture,decodeManifestBinary,hierarchyUpdateBatch,HIERARCHY_ROOT,MATRIX_VALUES,POSITION_VALUES,QUATERNION_VALUES } from '${packageName}';\n` +
      `globalThis.__installedSdk={createWorld,pose,metric,capture,decodeManifestBinary,hierarchyUpdateBatch,HIERARCHY_ROOT,MATRIX_VALUES,POSITION_VALUES,QUATERNION_VALUES};\n`,
  );
  run(
    bundler,
    [
      explorer,
      join(decodeRoot, 'pageDecodeWorker.js'),
      join(integrationRoot, 'pageIntegrationWorker.js'),
      join(physicsRoot, 'physicsWorker.js'),
      '--bundle',
      '--format=esm',
      '--platform=browser',
      '--splitting',
      '--entry-names=[name]',
      // Chunks beside the entries: a chunk names its worker beside itself (`besideModule`), as
      // the physics session, a chunk of its own, names `physicsWorker.js`.
      '--chunk-names=[name]-[hash]',
      `--outdir=${outputRoot}`,
      `--metafile=${metafile}`,
    ],
    fixture,
  );
  // Each WebAssembly module beside the chunk that fetches it by its own URL.
  const modules = [
    join(decodeRoot, 'pageCodec.wasm'),
    join(physicsRoot, 'joltPhysics.wasm'),
    join(physicsRoot, 'joltPhysicsThreads.wasm'),
  ];
  for (const { path } of filesAt(outputRoot)) {
    if (!path.endsWith('.js')) continue;
    const text = readFileSync(join(outputRoot, path), 'utf8');
    for (const wasm of modules.filter((file) => text.includes(basename(file))))
      cpSync(wasm, join(dirname(join(outputRoot, path)), basename(wasm)));
  }
  for (const name of sceneCaches)
    cpSync(join(fixture, name), join(outputRoot, name), { recursive: true });
  cpSync(join(fixture, 'common-worker.js'), join(outputRoot, 'common-worker.js'));
  const assets = filesAt(outputRoot);
  const entries = [
    'explorer.js',
    'pageDecodeWorker.js',
    'pageIntegrationWorker.js',
    'physicsWorker.js',
  ];
  for (const required of entries)
    if (!assets.some(({ path }) => path === required))
      throw new Error(`browser bundle did not emit ${required}`);
  checkPhysicsBeside(outputRoot, assets);
  if (!assets.some(({ path }) => path.endsWith('/pageCodec.wasm')))
    throw new Error('browser bundle did not place pageCodec.wasm beside its referring chunk');
  return {
    outputRoot,
    assets,
    metafile: JSON.parse(readFileSync(metafile, 'utf8')) as Metafile,
  };
}

async function proveBundledInstalledOutput(
  options: BrowserModesOptions,
): Promise<{ bundle: EmittedBrowserBundle; proof: InstalledBrowserProof }> {
  const bundle = emitInstalledBrowserBundle(options);
  const proof = await runBundledBrowser({
    outputRoot: bundle.outputRoot,
    manifestUrl: '/native-cache-primer/native/slice/manifest.json',
    replayUrl: '/native-cache-replay/native/slice/manifest.json',
  });
  return { bundle, proof };
}

export interface InstalledBrowserModesProof {
  direct: InstalledBrowserProof;
  bundled: { bundle: EmittedBrowserBundle; proof: InstalledBrowserProof };
}

export async function proveInstalledBrowserModes(
  options: BrowserModesOptions,
): Promise<InstalledBrowserModesProof> {
  const urls = {
    manifestUrl: '/native-cache-primer/native/slice/manifest.json',
    replayUrl: '/native-cache-replay/native/slice/manifest.json',
  };
  const direct = await proveInstalledBrowser({
    fixture: options.fixture,
    packageName: options.packageName,
    browserEntry: options.browserEntry,
    ...urls,
  });
  const bundled = await proveBundledInstalledOutput(options);
  if (direct.capture.sha256 !== bundled.proof.capture.sha256)
    throw new Error('direct and bundled installed browser captures differ');
  bundled.proof.capture.differentPixelsFromDirect = 0;
  return { direct, bundled };
}

export function browserEvidence(run: InstalledBrowserModesProof | null) {
  if (!run) return null;
  return {
    modules: run.direct,
    bundle: { ...run.bundled.proof, assets: run.bundled.bundle.assets },
  };
}
