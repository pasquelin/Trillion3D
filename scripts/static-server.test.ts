import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { createDocsServer, isCacheObject } from './docs-serve.ts';
import { installedServer, type RequestRecord } from './installed-package-server.ts';
import { acceptsBrotli, listen, staticServer } from './static-server.ts';

const SITE = resolve(import.meta.dirname, '../site');

/** The status and content type `server` answers on `path`, the server closed afterwards. */
async function fetched(server: Server, path: string) {
  const response = await fetch(`http://127.0.0.1:${await listen(server)}${path}`);
  await response.arrayBuffer();
  // Every connection closed before the caller reads what the server recorded; a kept-alive one
  // would hold the close back for seconds.
  const closed = new Promise((done) => server.close(done));
  server.closeAllConnections();
  await closed;
  return [response.status, response.headers.get('content-type')];
}

test('the docs server answers a directory with its index, an escape with 403', async () => {
  assert.deepEqual(await fetched(createDocsServer(SITE), '/'), [200, 'text/html; charset=utf-8']);
  assert.deepEqual(await fetched(createDocsServer(SITE), '/..%2Fpackage.json'), [403, null]);
});

test('the installed-package server records what it refused, its page in utf-8', async () => {
  const requests: RequestRecord[] = [];
  const server = () => installedServer(SITE, '<p>', requests, false);
  assert.deepEqual(await fetched(server(), '/'), [200, 'text/html; charset=utf-8']);
  for (const path of ['/node_modules/x', '/node%5Fmodules/x'])
    assert.deepEqual(await fetched(server(), path), [403, null]);
  assert.deepEqual(requests, [
    { path: '/node_modules/x', status: 403 },
    { path: '/node%5Fmodules/x', status: 403 },
  ]);
});

test('brotli is accepted when named without a zero weight', () => {
  for (const header of ['br', 'gzip, deflate, br, zstd', 'br;q=0.5', 'BR', ' gzip ;q=1, br '])
    assert.ok(acceptsBrotli(header), header);
  for (const header of [undefined, '', 'gzip', 'br;q=0', 'br; q=0.000', 'brotli', 'identity'])
    assert.ok(!acceptsBrotli(header), String(header));
});

test('the docs server compresses the caches objects only', () => {
  assert.ok(isCacheObject('/site/assets/examples/bust/cache/objects/ab12.bin'));
  assert.ok(isCacheObject('C:\\site\\cache\\objects\\ab12.bin'));
  for (const file of [
    '/cache/objects/ab12.json',
    '/cache/native/full/page.bin',
    '/objects/x/a.txt',
  ])
    assert.ok(!isCacheObject(file), file);
});

/** The headers and raw body `server` answers on `path` for `accept`, without any decoding. */
async function raw(server: Server, path: string, accept?: string) {
  const port = await listen(server);
  const headers = accept === undefined ? {} : { 'accept-encoding': accept };
  const answer = await new Promise<{ headers: Record<string, unknown>; body: Buffer }>((done) =>
    request({ port, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done({ headers: response.headers, body: Buffer.concat(chunks) }));
    }).end(),
  );
  const closed = new Promise((done) => server.close(done));
  server.closeAllConnections();
  await closed;
  return answer;
}

test('a compressed file goes brotli to who accepts it, as is to anyone else', async () => {
  const dir = resolve(SITE, 'assets/examples/bust/source'),
    file = readFileSync(resolve(dir, 'setting.bin'));
  const server = () =>
    staticServer({ mounts: [{ prefix: '/', dir }], compress: (f) => f.endsWith('.bin') });
  const encoded = await raw(server(), '/setting.bin', 'gzip, br');
  assert.equal(encoded.headers['content-encoding'], 'br');
  assert.equal(encoded.headers.vary, 'accept-encoding');
  assert.ok(encoded.body.byteLength < file.byteLength);
  assert.deepEqual(brotliDecompressSync(encoded.body), file, 'decoded, the file itself');
  for (const accept of [undefined, 'gzip', 'br;q=0']) {
    const plain = await raw(server(), '/setting.bin', accept);
    assert.equal(plain.headers['content-encoding'], undefined, String(accept));
    assert.equal(plain.headers['content-length'], String(file.byteLength));
    assert.deepEqual(plain.body, file);
  }
  const text = await raw(staticServer({ mounts: [{ prefix: '/', dir: SITE }] }), '/', 'br');
  assert.equal(text.headers['content-encoding'], undefined, 'no compress option, no encoding');
});
