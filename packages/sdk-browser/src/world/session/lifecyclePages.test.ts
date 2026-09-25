import test from 'node:test';
import assert from 'node:assert/strict';
import type { JobProgress } from '../../../../sdk-core/src/index.ts';
import { sha256Hex } from '../../measurement/sha256Hex.ts';
import { createPageStreamer } from '../../streaming/pageStreamer.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { createExplorerLifecycle } from './lifecycle.ts';

type Session = Parameters<typeof createExplorerLifecycle>[0];
type Inputs = Parameters<typeof createExplorerLifecycle>[1];

/** A session whose one backend lacks `missing` until they are handed to it, over a real streamer
 *  of three verified pages. */
async function lackingPages(missing: string[]) {
  const bytes = new Uint8Array([1, 0, 0, 0]);
  const sha256 = await sha256Hex(bytes.buffer);
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
  const pages = ['a.bin', 'b.bin', 'c.bin'].map((url) => ({ url, bytes: 4, sha256 }));
  const streamer = createPageStreamer(pages, 'http://cache/');
  const accepted: string[] = [];
  const backend = {
    render() {},
    pendingUrls: () => missing.filter((url) => !accepted.includes(url)),
    acceptPage: (url: string) => void accepted.push(url),
    syncResident() {},
  };
  const inputs = {
    check() {},
    state: {},
    streamer,
    streaming: {},
    backends: [backend],
    camera: G.perspectiveCamera(),
    geometryUrls: new Set<string>(),
  } as unknown as Inputs;
  const session = { scope: 'slice' } as unknown as Session;
  return { lifecycle: createExplorerLifecycle(session, inputs), accepted, streamer };
}

test('awaitPages reports each page the view lacked as it lands, then completed === total', async () => {
  const { lifecycle, accepted, streamer } = await lackingPages(['a.bin', 'b.bin']);
  const heard: JobProgress[] = [];
  await lifecycle.awaitPages({ image: false, onProgress: (event) => heard.push(event) });
  assert.deepEqual(accepted.sort(), ['a.bin', 'b.bin']);
  assert.ok(heard.every((event) => event.phase === 'pages'));
  assert.deepEqual(
    heard.map(({ completed, total }) => [completed, total]),
    [
      [0, 2],
      [1, 2],
      [2, 2],
      [2, 2],
    ],
  );
  streamer.dispose();
});

test('awaitPages counts the pages the streamer reads: once each, only those it holds', async () => {
  const { lifecycle, streamer } = await lackingPages(['a.bin', 'a.bin', 'unknown.bin', 'b.bin']);
  const heard: JobProgress[] = [];
  await lifecycle.awaitPages({ onProgress: (event) => heard.push(event) });
  assert.deepEqual(
    heard.map(({ completed, total }) => [completed, total]),
    [
      [0, 2],
      [1, 2],
      [2, 2],
      [2, 2],
    ],
    'the total is what the streamer requests, reached without a jump',
  );
  streamer.dispose();
});

test('awaitPages with every page resident still closes its count', async () => {
  const { lifecycle, streamer } = await lackingPages([]);
  const heard: JobProgress[] = [];
  await lifecycle.awaitPages({ onProgress: (event) => heard.push(event) });
  assert.deepEqual(
    heard.map(({ phase, completed, total }) => [phase, completed, total]),
    [['pages', 0, 0]],
  );
  streamer.dispose();
});
