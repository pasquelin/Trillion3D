import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server, ServerResponse } from 'node:http';
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { compressCacheObjects, isCacheObject } from './compress-cache-objects.ts';
import { createDocsServer } from './docs-serve.ts';
import { installedServer, type RequestRecord } from './installed-package-server.ts';
import { acceptsBrotli, listen, staticServer } from './static-server.ts';

const SITE = resolve(import.meta.dirname, '../site'),
  LOGS = resolve(import.meta.dirname, '../.worktrees/logs');

/** Closes `server` and every connection: a kept-alive one would hold the close back for seconds. */
async function closeAll(server: Server) {
  const closed = new Promise((done) => server.close(done));
  server.closeAllConnections();
  await closed;
}

/** The status and content type `server` answers on `path`, the server closed afterwards. */
async function fetched(server: Server, path: string) {
  const response = await fetch(`http://127.0.0.1:${await listen(server)}${path}`);
  await response.arrayBuffer();
  await closeAll(server); // before the caller reads what the server recorded
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
  await closeAll(server);
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

/** A site-shaped tree in `.worktrees/logs/`: one cache object and one other binary, both `page`. */
function cacheTree(t: test.TestContext, page: Buffer) {
  mkdirSync(LOGS, { recursive: true });
  const root = mkdtempSync(join(LOGS, 'static-server-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'cache/objects'), { recursive: true });
  writeFileSync(join(root, 'cache/objects/ab12.bin'), page);
  writeFileSync(join(root, 'cache/page.bin'), page);
  return root;
}

test('the docs server sends a cache object brotli-encoded, any other file as is', async (t) => {
  const page = Buffer.alloc(4096, 7),
    root = cacheTree(t, page);
  const object = await raw(createDocsServer(root), '/cache/objects/ab12.bin', 'br');
  assert.equal(object.headers['content-encoding'], 'br');
  assert.deepEqual(brotliDecompressSync(object.body), page);
  const other = await raw(createDocsServer(root), '/cache/page.bin', 'br');
  assert.equal(other.headers['content-encoding'], undefined);
  assert.deepEqual(other.body, page);
});

test('the deploy pre-compresses the cache objects only, which decode to themselves', async (t) => {
  const page = Buffer.alloc(4096, 7),
    root = cacheTree(t, page);
  assert.equal(await compressCacheObjects(root), 1);
  const encoded = readFileSync(join(root, 'cache/objects/ab12.bin.br'));
  assert.ok(encoded.byteLength < page.byteLength);
  assert.deepEqual(brotliDecompressSync(encoded), page);
  assert.throws(() => readFileSync(join(root, 'cache/page.bin.br')), { code: 'ENOENT' });
});

test('a request aborted before its file opens leaves no file open and pipes nothing', async (t) => {
  const root = cacheTree(t, Buffer.alloc(4096, 7)),
    read = fs.createReadStream,
    { promise: made, resolve: make } = Promise.withResolvers<fs.ReadStream>(),
    { promise: piped, resolve: pipe } = Promise.withResolvers<void>();
  // The server's file stream, caught as it is made (a built-in's exports follow its object).
  t.mock.method(fs, 'createReadStream', (...args: Parameters<typeof read>) => {
    const stream = read(...args);
    make(stream);
    return stream;
  });
  syncBuiltinESMExports();
  t.after(syncBuiltinESMExports);
  const server = staticServer({ mounts: [{ prefix: '/', dir: root }] }),
    port = await listen(server),
    said = t.mock.method(console, 'error', () => pipe());
  // The client gone as the server starts on the file: its response closes before the file opens.
  server.on('request', (_, response: ServerResponse) => response.destroy());
  request({ port, path: '/cache/page.bin' }).on('error', () => {}).end();
  const stream = await made;
  // Either the file closes, or the server says it could not pipe onto the closed response.
  await Promise.race([once(stream, 'close'), piped]);
  await closeAll(server);
  assert.equal(said.mock.callCount(), 0, 'no pipe onto the closed response');
  assert.ok(stream.closed, 'the file stream is closed with the response');
});

test('the docs server isolates every page across origins, as the published site does', async (t) => {
  const answer = await raw(createDocsServer(cacheTree(t, Buffer.alloc(8))), '/cache/page.bin');
  assert.equal(answer.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(answer.headers['cross-origin-embedder-policy'], 'credentialless');
});
