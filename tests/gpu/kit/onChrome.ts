// The other GPU a proof runs on: the system Chrome (`launchChrome`), for what Dawn does not have —
// the WebGL2 backend, and the witness library's WebGL renderer a WebGPU image is compared with. A
// proof's page module is served from the sources, stripped of its types by the bench harness's
// server (`tests/kit/server/staticServer.ts`), imported by its blank page and called there: what
// it answers is the proof's reading. These proofs are the recette's (`pnpm run test:chrome`, which
// runs `bench/dawn/proofs.ts --chrome`), never a merge's, and open Chrome under the machine's bench
// lock — shared with the run that started them, taken by a proof run on its own.
import assert from 'node:assert/strict';
import { relative, resolve, sep } from 'node:path';
import { takeBenchLock } from '../../../bench/dawn/lock.ts';
import { assertBrowserEntryPoint, launchChrome } from '../../../bench/runner/chrome.ts';
import { ENGINES, resolveMounts } from '../../../bench/runner/options.ts';
import { startServer } from '../../kit/server/staticServer.ts';
import type { Mount } from '../../../scripts/static-server.ts';

/** The repository, whose files the page imports by their path. */
const ROOT = resolve(import.meta.dirname, '../../..');

/** The page a proof opens. `webgpu: false` removes `navigator.gpu` before any script runs: a
 *  machine without WebGPU, changed where the engine reads it and nowhere else. `mounts` serve
 *  what lies outside the repository's tree — a cache the proof compiled — before it. */
export interface ChromePage {
  webgpu?: boolean;
  viewport?: { width: number; height: number };
  mounts?: Mount[];
}

/** Whether this process holds the bench lock: taken once, released when it exits. */
let locked = false;

/** What the page is asked: the module's URL, its export, and the argument handed to it. */
type Call = { url: string; method: string; argument: unknown };

/**
 * Imports the page module `page` — an absolute path, the proof's `resolve(import.meta.dirname, …)`
 * — in a fresh headless Chrome, and resolves to what its export `method` answers to `argument`,
 * through JSON. The method's rejection fails the proof with its own message, and so does an error
 * the page did not catch while it ran.
 */
export async function inChrome<R>(
  page: string,
  method: string,
  argument: unknown = null,
  { webgpu = true, viewport = { width: 640, height: 480 }, mounts = [] }: ChromePage = {},
): Promise<R> {
  assertBrowserEntryPoint();
  if (!locked) takeBenchLock(`Chrome proof ${process.argv[1] ?? ''}`);
  locked = true;
  const { server, port } = await startServer({
    mounts: [...mounts, ...resolveMounts(ROOT, []), { prefix: '/', dir: ROOT }],
  });
  try {
    const browser = await launchChrome({ headless: true, args: ENGINES.webgpu.flags });
    try {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      if (!webgpu)
        await context.addInitScript(() =>
          Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined }),
        );
      const tab = await context.newPage();
      const errors: string[] = [];
      tab.on('pageerror', (error) => errors.push(error.message));
      await tab.goto(`http://127.0.0.1:${port}/`);
      const url = `/${relative(ROOT, page).split(sep).join('/')}`;
      const answer = await tab.evaluate(
        async ({ url, method, argument }: Call) => (await import(url))[method](argument),
        { url, method, argument },
      );
      assert.deepEqual(errors, [], 'errors the page did not catch');
      return answer as R;
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
}
