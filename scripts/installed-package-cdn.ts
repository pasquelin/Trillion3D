import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInstalledBrowser } from './installed-package-browser.ts';
import type { InstalledBrowserProof } from './installed-package-browser-result.ts';
import { missingBeside } from './installed-package-beside.ts';
import { familyChunks } from './bundle-fold.ts';
import type { Run } from './installed-package-contracts.ts';

/** Where the fixture server serves the unpacked archive, as a CDN serves a package's files. */
const CDN_PATH = '/cdn/package/dist';

/** The bundle's files at the root of the archive's `dist/`, as a CDN lists them. */
function bundleFiles(dist: string) {
  return readdirSync(dist, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map(({ name }) => name);
}

/** The name a chunk starts the physics worker by (`besideModule('physicsWorker', …)`), quoted:
 *  the core names `physicsWorker.js` too, in its build provenance, and starts nothing. */
const STARTS_PHYSICS = /["']physicsWorker["']/;

/** The bundle's physics: its worker, its modules and every chunk that starts them. A page that
 *  enables no physics requests none of them. */
export function physicsFiles(dist: string): string[] {
  return bundleFiles(dist).filter(
    (name) =>
      name === 'physicsWorker.js' ||
      /^joltPhysics.*\.wasm$/.test(name) ||
      (name.endsWith('.js') && STARTS_PHYSICS.test(readFileSync(join(dist, name), 'utf8'))),
  );
}

/** The bundle's fluids: the chunk of their code (`bundle-fold.ts`), the water pass and the
 *  particle steps. A page with no transmissive surface and no particle pool requests none. */
export const fluidFiles = (dist: string): string[] =>
  familyChunks(dist, 'fluids').flatMap(({ chunk }) => (chunk ? [chunk] : []));

/** The requests of a proof page among `files` of the bundle served at `CDN_PATH`. */
const requested = (paths: string[], files: string[]) => {
  const served = new Set(files.map((name) => `${CDN_PATH}/${name}`));
  return paths.filter((path) => served.has(path));
};

/**
 * The packed archive unpacked under the fixture's `cdn/`, its `dist/` checked: the core module
 * and, beside each chunk, the workers and WebAssembly modules it names. Returns that `dist/`.
 */
export function unpackCdn(fixture: string, run: Run): string {
  const archive = readdirSync(fixture).find((name) => name.endsWith('.tgz'));
  if (!archive) throw new Error('no packed archive in the fixture');
  mkdirSync(join(fixture, 'cdn'), { recursive: true });
  run('tar', ['-xzf', join(fixture, archive), '-C', join(fixture, 'cdn')]);
  const dist = join(fixture, 'cdn/package/dist');
  const files = bundleFiles(dist);
  if (!files.includes('trillion3d.module.js')) throw new Error('archive has no CDN bundle');
  const chunks = files
    .filter((name) => name.endsWith('.js'))
    .map((path) => ({ path, text: readFileSync(join(dist, path), 'utf8') }));
  const missing = missingBeside(chunks, files);
  if (missing.length) throw new Error(`CDN bundle: ${missing.join('; ')}`);
  return dist;
}

/**
 * The page on `127.0.0.1` loads the bundle through an `importmap` from `localhost`, another
 * origin, as it would from jsDelivr or unpkg: one import, the engine's workers started across
 * origins. No request reaches the installed `node_modules`, none the physics nor the fluids.
 */
export async function proveCdnBrowser({
  fixture,
  packageName,
  run,
  ...urls
}: {
  fixture: string;
  packageName: string;
  run: Run;
  manifestUrl: string;
  replayUrl: string;
}): Promise<InstalledBrowserProof & { physicsRequests: string[]; fluidRequests: string[] }> {
  const dist = unpackCdn(fixture, run);
  const html = (port: number) => {
    const imports = { [packageName]: `http://localhost:${port}${CDN_PATH}/trillion3d.module.js` };
    return `<!doctype html><canvas id="primer"></canvas><canvas id="replay"></canvas><script type="importmap">${JSON.stringify({ imports })}</script>`;
  };
  const proof = await runInstalledBrowser({
    root: fixture,
    html,
    moduleName: packageName,
    decodeWorkerPath: `${CDN_PATH}/pageDecodeWorker.js`,
    integrationWorkerPath: `${CDN_PATH}/pageIntegrationWorker.js`,
    commonWorkerPath: '/common-worker.js',
    ...urls,
  });
  const paths = proof.requests.map(({ path }) => path);
  const physicsRequests = requested(paths, physicsFiles(dist));
  if (physicsRequests.length)
    throw new Error(`a scene without physics fetched ${physicsRequests.join(', ')}`);
  const fluidRequests = requested(paths, fluidFiles(dist));
  if (fluidRequests.length)
    throw new Error(`a scene without fluids fetched ${fluidRequests.join(', ')}`);
  return { ...proof, physicsRequests, fluidRequests };
}
