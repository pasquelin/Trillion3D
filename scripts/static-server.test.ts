import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createDocsServer } from './docs-serve.ts';
import { installedServer, type RequestRecord } from './installed-package-server.ts';
import { fileUnder, listen } from './static-server.ts';
import type { Server } from 'node:http';

const SITE = resolve(import.meta.dirname, '../site');

/** The status and content type `server` answers on `path`, the server closed afterwards. */
async function fetched(server: Server, path: string) {
  try {
    const response = await fetch(`http://127.0.0.1:${await listen(server)}${path}`);
    await response.arrayBuffer();
    return [response.status, response.headers.get('content-type')];
  } finally {
    server.close();
  }
}

test('a path that leaves its directory is refused, one inside it resolves under it', () => {
  assert.equal(fileUnder(SITE, '..%2Fpackage.json'), null);
  assert.equal(fileUnder(SITE, 'styles/portal.css'), resolve(SITE, 'styles/portal.css'));
});

test('the docs server answers a directory with its index, an escape with 403', async () => {
  assert.deepEqual(await fetched(createDocsServer(SITE), '/'), [200, 'text/html']);
  assert.deepEqual(await fetched(createDocsServer(SITE), '/..%2Fpackage.json'), [403, null]);
});

test('the installed-package server records what it served, its page in utf-8', async () => {
  const requests: RequestRecord[] = [];
  const page = await fetched(installedServer(SITE, '<p>', requests, false), '/');
  assert.deepEqual(page, [200, 'text/html; charset=utf-8']);
  assert.deepEqual(await fetched(installedServer(SITE, '', requests, false), '/node_modules/x'), [
    403,
    null,
  ]);
  const encoded = installedServer(SITE, '', requests, false);
  assert.deepEqual(await fetched(encoded, '/node%5Fmodules/x'), [403, null]);
  assert.deepEqual(requests, [
    { path: '/node_modules/x', status: 403 },
    { path: '/node%5Fmodules/x', status: 403 },
  ]);
});
