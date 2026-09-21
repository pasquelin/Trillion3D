// Cross-origin isolation of harness server: it, and it alone, decides whether SDK
// takes its shared memory path. Closed default: a reference campaign does not change
// paths unless explicitly written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serverPort, startServer } from './serveur.ts';
import { resolve } from 'node:path';
import { readOptions } from './options.ts';

/** The header `nom` returned by a harness server launched with these options, then closed. */
async function entete(options: { isolation?: boolean }, nom: string) {
  const server = await startServer({ port: 0, mounts: [], captures: new Map(), ...options });
  try {
    const reponse = await fetch(`http://127.0.0.1:${serverPort(server)}/`);
    await reponse.arrayBuffer();
    return reponse.headers.get(nom);
  } finally {
    server.close();
  }
}

test('without isolation — default — no COOP/COEP header leaves the server', async () => {
  assert.equal(await entete({}, 'cross-origin-opener-policy'), null);
  assert.equal(await entete({ isolation: false }, 'cross-origin-embedder-policy'), null);
});

test('with isolation, COOP and COEP leave on every response', async () => {
  assert.equal(await entete({ isolation: true }, 'cross-origin-opener-policy'), 'same-origin');
  assert.equal(await entete({ isolation: true }, 'cross-origin-embedder-policy'), 'require-corp');
});

test('--isolation is only on or off, and defaults to off when unstated', () => {
  assert.equal(readOptions([], process.cwd()).settings.isolation, false);
  assert.equal(readOptions(['--isolation', 'on'], process.cwd()).settings.isolation, true);
  assert.equal(readOptions(['--isolation', 'off'], process.cwd()).settings.isolation, false);
  assert.throws(() => readOptions(['--isolation', 'oui'], process.cwd()), /--isolation/);
});

test('portal stylesheets are served as CSS so browser proofs use the real layout', async () => {
  const server = await startServer({
    port: 0,
    captures: new Map(),
    mounts: [{ prefix: '/styles/', dir: resolve(import.meta.dirname, '../../site/styles') }],
  });
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort(server)}/styles/portal.css`);
    assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.match(await response.text(), /render-frame/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test('a TypeScript page module is served as JavaScript, its types stripped', async () => {
  const server = await startServer({
    port: 0,
    captures: new Map(),
    mounts: [{ prefix: '/mesure/', dir: resolve(import.meta.dirname) }],
  });
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort(server)}/mesure/serveur.ts`);
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    const code = await response.text();
    assert.match(code, /function startServer\(/);
    assert.match(code, /export \{[^}]*\bstartServer\b/);
    assert.doesNotMatch(code, /: Mount\[\]/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
