// A Chrome page serving this tree's engine (`dist/`), the bench runner and the in-page helpers of
// `benchScenePage.ts`, with the bench's WebGPU flags: what the proofs on the bench scene open.
import { resolve } from 'node:path';
import { startServer, serverPort } from '../../kit/server/staticServer.ts';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { resolveMounts } from '../../../bench/runner/options.ts';
import { ENGINES } from '../../../bench/runner/sideOptions.ts';

const root = resolve(import.meta.dirname, '../../..');

export async function openBenchPage(width: number, height: number) {
  const server = await startServer({
    port: 0,
    captures: new Map(),
    mounts: [
      ...resolveMounts(root, []),
      { prefix: '/sdk/', dir: resolve(root, 'dist') },
      { prefix: '/support/', dir: resolve(root, 'tests/browser/support') },
    ],
  });
  // GPU timestamps are what the shadow budget measures itself against.
  const browser = await launchChrome({ headless: true, args: ENGINES.webgpu.flags });
  const errors: string[] = [];
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
  return {
    root,
    page,
    errors,
    /** URLs the page imports: the engine, the bench trajectory and the helpers. */
    urls: {
      sdkUrl: '/sdk/witnesses/measurement.js',
      posesUrl: '/runner/poses.ts',
      worldUrl: '/support/benchScenePage.ts',
    },
    async close() {
      await browser.close();
      await new Promise((done) => server.close(done));
    },
  };
}
