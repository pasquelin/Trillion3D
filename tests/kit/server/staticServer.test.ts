// Cross-origin isolation of harness server: it, and it alone, decides whether SDK
// takes its shared memory path. Closed default: a reference campaign does not change
// paths unless explicitly written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './staticServer.ts';
import { resolve } from 'node:path';
import { readOptions } from '../../../bench/runner/options.ts';

/** The response a harness server started with `options` gives on `path`, its body read, the
 *  server closed. */
async function served(path: string, options: Partial<Parameters<typeof startServer>[0]> = {}) {
  const { server, port } = await startServer({ mounts: [], ...options });
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return { headers: response.headers, text: await response.text() };
  } finally {
    server.close();
  }
}

const header = async (options: { isolation?: boolean }, name: string) =>
  (await served('/', options)).headers.get(name);

test('without isolation — default — no COOP/COEP header leaves the server', async () => {
  assert.equal(await header({}, 'cross-origin-opener-policy'), null);
  assert.equal(await header({ isolation: false }, 'cross-origin-embedder-policy'), null);
});

test('with isolation, COOP and COEP leave on every response', async () => {
  assert.equal(await header({ isolation: true }, 'cross-origin-opener-policy'), 'same-origin');
  assert.equal(await header({ isolation: true }, 'cross-origin-embedder-policy'), 'require-corp');
});

test('--isolation is only on or off, and defaults to off when unstated', () => {
  assert.equal(readOptions([], process.cwd()).settings.isolation, false);
  assert.equal(readOptions(['--isolation', 'on'], process.cwd()).settings.isolation, true);
  assert.equal(readOptions(['--isolation', 'off'], process.cwd()).settings.isolation, false);
  assert.throws(() => readOptions(['--isolation', 'oui'], process.cwd()), /--isolation/);
});

test('portal stylesheets are served as CSS so browser proofs use the real layout', async () => {
  const dir = resolve(import.meta.dirname, '../../../site/styles');
  const { headers, text } = await served('/styles/portal.css', {
    mounts: [{ prefix: '/styles/', dir }],
  });
  assert.equal(headers.get('content-type'), 'text/css; charset=utf-8');
  assert.match(text, /render-frame/);
});

test('a TypeScript page module is served as JavaScript, its types stripped', async () => {
  const mounts = [{ prefix: '/runner/', dir: import.meta.dirname }];
  const { headers, text } = await served('/runner/staticServer.ts', { mounts });
  assert.equal(headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(text, /function startServer\(/);
  assert.match(text, /export \{[^}]*\bstartServer\b/);
  assert.doesNotMatch(text, /: Mount\[\]/);
});
