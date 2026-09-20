import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  proveBundledInstalledBrowser as runBundledBrowser,
  proveInstalledBrowser,
} from './installed-package-browser-modes.mjs';

const sceneCaches = ['native-cache-primer', 'native-cache-replay'];

function filesAt(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesAt(root, path)
      : [{ path: path.slice(root.length + 1), size: statSync(path).size }];
  });
}

export function emitInstalledBrowserBundle({ fixture, packageName, bundler, run }) {
  const outputRoot = join(fixture, 'browser-output');
  const packageRoot = join(fixture, 'node_modules', packageName);
  const resourceRoot = join(packageRoot, 'dist/sdk-browser');
  const explorer = join(fixture, 'explorer.ts');
  const metafile = join(outputRoot, 'metafile.json');
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(
    explorer,
    `import { createExplorer,decodeManifestBinary,hierarchyUpdateBatch,HIERARCHY_ROOT,MATRIX_VALUES,POSITION_VALUES,QUATERNION_VALUES } from '${packageName}';\n` +
      `globalThis.__installedSdk={createExplorer,decodeManifestBinary,hierarchyUpdateBatch,HIERARCHY_ROOT,MATRIX_VALUES,POSITION_VALUES,QUATERNION_VALUES};\n`,
  );
  run(
    bundler,
    [
      explorer,
      join(resourceRoot, 'pageDecodeWorker.js'),
      join(resourceRoot, 'pageIntegrationWorker.js'),
      '--bundle',
      '--format=esm',
      '--platform=browser',
      '--splitting',
      '--entry-names=[name]',
      '--chunk-names=chunks/[name]-[hash]',
      `--outdir=${outputRoot}`,
      `--metafile=${metafile}`,
    ],
    fixture,
  );
  const wasm = join(resourceRoot, 'pageCodec.wasm');
  for (const { path } of filesAt(outputRoot))
    if (
      path.endsWith('.js') &&
      readFileSync(join(outputRoot, path), 'utf8').includes('pageCodec.wasm')
    )
      cpSync(wasm, join(dirname(join(outputRoot, path)), 'pageCodec.wasm'));
  for (const name of sceneCaches)
    cpSync(join(fixture, name), join(outputRoot, name), { recursive: true });
  cpSync(join(fixture, 'common-worker.js'), join(outputRoot, 'common-worker.js'));
  const assets = filesAt(outputRoot);
  for (const required of ['explorer.js', 'pageDecodeWorker.js', 'pageIntegrationWorker.js'])
    if (!assets.some(({ path }) => path === required))
      throw new Error(`browser bundle did not emit ${required}`);
  if (!assets.some(({ path }) => path.endsWith('/pageCodec.wasm')))
    throw new Error('browser bundle did not place pageCodec.wasm beside its referring chunk');
  return {
    outputRoot,
    assets,
    metafile: JSON.parse(readFileSync(metafile, 'utf8')),
  };
}

async function proveBundledInstalledOutput(options) {
  const bundle = emitInstalledBrowserBundle(options);
  const proof = await runBundledBrowser({
    outputRoot: bundle.outputRoot,
    manifestUrl: '/native-cache-primer/native/slice/manifest.json',
    replayUrl: '/native-cache-replay/native/slice/manifest.json',
  });
  return { bundle, proof };
}

export async function proveInstalledBrowserModes(options) {
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

export function browserEvidence(run) {
  if (!run) return null;
  return {
    modules: run.direct,
    bundle: { ...run.bundled.proof, assets: run.bundled.bundle.assets },
  };
}
