import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInstalledBrowser } from './installed-package-browser.ts';
import type { InstalledBrowserProof } from './installed-package-browser-result.ts';
import { missingBeside, PHYSICS_RULE, type EmittedChunk } from './installed-package-beside.ts';
import { BUNDLE_ENTRY } from './build-bundle.ts';
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

/** The bundle's physics among its `files`: the worker and modules found beside the chunk that
 *  starts them (`installed-package-beside.ts`), and every such chunk of `chunks`. A page that
 *  enables no physics requests none of them. */
export function physicsFiles(files: string[], chunks: EmittedChunk[]): string[] {
  const beside = PHYSICS_RULE.beside;
  const starting = chunks.filter(({ text }) => STARTS_PHYSICS.test(text)).map(({ path }) => path);
  return [...new Set([...files.filter((name) => beside.includes(name)), ...starting])];
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

/** The CDN bundle unpacked from the archive: its `dist/`, the files at its root, its chunks. */
export interface UnpackedCdn {
  dist: string;
  files: string[];
  chunks: EmittedChunk[];
}

/**
 * The packed archive unpacked under the fixture's `cdn/`, its `dist/` checked: the core module
 * and, beside each chunk, the workers and WebAssembly modules it names. Returns that `dist/`, its
 * files and its chunks.
 */
export function unpackCdn(fixture: string, run: Run): UnpackedCdn {
  const archive = readdirSync(fixture).find((name) => name.endsWith('.tgz'));
  if (!archive) throw new Error('no packed archive in the fixture');
  mkdirSync(join(fixture, 'cdn'), { recursive: true });
  run('tar', ['-xzf', join(fixture, archive), '-C', join(fixture, 'cdn')]);
  const dist = join(fixture, 'cdn/package/dist');
  const files = bundleFiles(dist);
  if (!files.includes(BUNDLE_ENTRY)) throw new Error('archive has no CDN bundle');
  const chunks = files
    .filter((name) => name.endsWith('.js'))
    .map((path) => ({ path, text: readFileSync(join(dist, path), 'utf8') }));
  const missing = missingBeside(chunks, files);
  if (missing.length) throw new Error(`CDN bundle: ${missing.join('; ')}`);
  return { dist, files, chunks };
}

/**
 * The page on `127.0.0.1` loads the bundle through an `importmap` from `localhost`, another
 * origin, as it would from jsDelivr or unpkg: one import, the engine's workers started across
 * origins. No request reaches the installed `node_modules`, none the physics nor the fluids.
 */
export async function proveCdnBrowser({
  fixture,
  packageName,
  unpacked: { dist, files, chunks },
  ...urls
}: {
  fixture: string;
  packageName: string;
  unpacked: UnpackedCdn;
  manifestUrl: string;
  replayUrl: string;
}): Promise<InstalledBrowserProof & { physicsRequests: string[]; fluidRequests: string[] }> {
  const html = (port: number) => {
    const imports = { [packageName]: `http://localhost:${port}${CDN_PATH}/${BUNDLE_ENTRY}` };
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
  const physicsRequests = requested(paths, physicsFiles(files, chunks));
  const fluidRequests = requested(paths, fluidFiles(dist));
  for (const [family, fetched] of [
    ['physics', physicsRequests],
    ['fluids', fluidRequests],
  ] as const)
    if (fetched.length) throw new Error(`a scene without ${family} fetched ${fetched.join(', ')}`);
  return { ...proof, physicsRequests, fluidRequests };
}
