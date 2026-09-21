// A local Chromium page where WebGPU is available, written once for every "GPU actually run"
// reproduction: the DAG selection kernel (`noyauSelectionGpu.ts`), rasterisation
// (`noyauRasterGpu.ts`), lighting normals (`normaleEclairageGpu.ts`), wrap batches
// (`adressageGpuPage.ts`) and the parented camera (`camera-parentee-gpu.ts`) use it. Playwright
// and esbuild are the repo's dev dependencies: the engine proves itself, with no other project
// on the machine.
import { createServer } from 'node:http';
import * as esbuild from 'esbuild';
import type { Format } from 'esbuild';
import { launchChrome } from '../../scripts/mesure/chrome.ts';
import { serverPort } from '../../scripts/mesure/serveur.ts';
import { ouvrirAppareil } from './appareilWebgpu.ts';

declare global {
  // eslint-disable-next-line no-var
  var ouvrirAppareil: typeof import('./appareilWebgpu.ts').ouvrirAppareil;
}

/**
 * Bundles a page module for the browser and returns the bundle text: as an IIFE under `nomGlobal`
 * for `dansPageWebgpu`, or as an ES module (`format: 'esm'`) when the page loads it via `import()`.
 * Bundle options — target, platform — are those of every reproduction: writing them here is what
 * stops two of them compiling for two different targets with nothing saying so.
 */
export async function empaquetePage(
  input: string,
  nomGlobal: string,
  { format = 'iife' }: { format?: Format } = {},
) {
  const paquet = await esbuild.build({
    entryPoints: [input],
    bundle: true,
    write: false,
    format,
    ...(format === 'iife' ? { globalName: nomGlobal } : {}),
    platform: 'browser',
    target: 'es2022',
    logLevel: 'error',
  });
  return paquet.outputFiles[0].text;
}

/**
 * Serves an empty page on a free port, opens it in Chromium and evaluates `fonction(argument)`
 * there. `fonction` runs in the page: it sees only its argument, serialised, and returns JSON.
 * `globalThis.ouvrirAppareil` is installed ahead of time (`appareilWebgpu.ts`), since a
 * serialised function does not see its module's scope.
 *
 * Options: `titre` (the page title), `script` (a bundle served on `/page.js` and loaded by the
 * page, for reproductions that need the engine's real modules) and `erreursPage` (an array that
 * uncaught page errors come to fill).
 */
export async function dansPageWebgpu<A, R>(
  fonction: (argument: A) => R | Promise<R>,
  argument: A,
  options: { titre?: string; script?: string | null; erreursPage?: string[] | null } = {},
) {
  const { titre = 'WebGeometry WebGPU', script = null, erreursPage = null } = options;
  const balise = script ? '<script src="/page.js"></script>' : '';
  const html = `<!doctype html><title>${titre}</title>${balise}`;
  const server = createServer((request, response) => {
    const sert = script && request.url === '/page.js';
    response.writeHead(200, { 'content-type': sert ? 'text/javascript' : 'text/html' });
    response.end(sert ? script : html);
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', () => ready()));
  const browser = await launchChrome({ headless: true });
  try {
    const page = await browser.newPage();
    if (erreursPage) page.on('pageerror', (error) => erreursPage.push(error.message));
    await page.addInitScript({ content: `globalThis.ouvrirAppareil = ${ouvrirAppareil};` });
    await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
    // `page.evaluate`'s `PageFunction<A, R>` runs `argument` through Playwright's `Unboxed<A>`,
    // which only differs from `A` when it carries a `JSHandle` — never the plain data this harness
    // sends. TypeScript cannot verify that for a free `A`, so the boundary is cast once here.
    const evaluate = page.evaluate as (fn: (argument: A) => R | Promise<R>, arg: A) => Promise<R>;
    return await evaluate(fonction, argument);
  } finally {
    await browser.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
}
