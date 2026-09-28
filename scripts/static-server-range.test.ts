import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { byteRange, listen, staticServer } from './static-server.ts';

const LOGS = resolve(import.meta.dirname, '../.worktrees/logs');

test('a Range header names one byte range, none, or none of the file', () => {
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange('bytes=90-200', 100), { start: 90, end: 99 }, 'clamped to the file');
  assert.deepEqual(byteRange('bytes=40-', 100), { start: 40, end: 99 });
  assert.deepEqual(byteRange('bytes=-30', 100), { start: 70, end: 99 });
  assert.deepEqual(byteRange('bytes=-300', 100), { start: 0, end: 99 });
  for (const header of [undefined, '', 'bytes=0-1,4-5', 'bytes=5-2', 'items=0-1', 'bytes=-'])
    assert.equal(byteRange(header, 100), undefined, String(header));
  for (const header of ['bytes=100-', 'bytes=100-120', 'bytes=-0'])
    assert.equal(byteRange(header, 100), null, header);
  assert.equal(byteRange('bytes=-5', 0), null, 'an empty file has no byte to give');
});

test('the server answers one byte range 206, an unsatisfiable one 416, none the whole file', async (t) => {
  mkdirSync(LOGS, { recursive: true });
  const root = mkdtempSync(join(LOGS, 'static-range-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  writeFileSync(join(root, 'level.ktx2'), bytes);
  // Compressed files too: a range addresses the file's own bytes, so it is never encoded.
  const server = staticServer({ mounts: [{ prefix: '/', dir: root }], compress: () => true });
  t.after(() => new Promise((done) => (server.close(done), server.closeAllConnections())));
  const port = await listen(server);
  const get = async (range?: string) => {
    const headers: Record<string, string> = { 'accept-encoding': 'identity' };
    if (range) headers.range = range;
    const response = await fetch(`http://127.0.0.1:${port}/level.ktx2`, { headers });
    const body = Buffer.from(await response.arrayBuffer());
    const header = (name: string) => response.headers.get(name);
    return {
      status: response.status,
      body,
      range: header('content-range'),
      length: header('content-length'),
      accepts: header('accept-ranges'),
    };
  };
  const cases: [string | undefined, number, string | null, Buffer][] = [
    ['bytes=16-31', 206, 'bytes 16-31/256', bytes.subarray(16, 32)],
    ['bytes=250-', 206, 'bytes 250-255/256', bytes.subarray(250)],
    ['bytes=-4', 206, 'bytes 252-255/256', bytes.subarray(252)],
    ['bytes=256-', 416, 'bytes */256', Buffer.alloc(0)],
    [undefined, 200, null, bytes],
  ];
  for (const [range, status, contentRange, body] of cases) {
    const answer = await get(range);
    assert.equal(answer.status, status, String(range));
    assert.equal(answer.range, contentRange, String(range));
    assert.deepEqual(answer.body, body, String(range));
    assert.equal(answer.accepts, 'bytes', String(range));
    if (status !== 416) assert.equal(answer.length, String(body.byteLength), String(range));
  }
});
