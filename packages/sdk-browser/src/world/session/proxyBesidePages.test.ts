import test from 'node:test';
import assert from 'node:assert/strict';
import { base, openSession, servedScene } from './proxySession.fixture.ts';
import { createPageCache } from '../../streaming/pageCache.ts';

test('a proxy above the transfer budget, asked while pages stream, lands beside them, reserved in flight and not counted as a page', async () => {
  // Above the 8 MiB the page queue lets through at once, as a proxy at its triangle budget is.
  const triangles = 220_000;
  const { metadata, urls, asked, release } = await servedScene(3, {
    triangles,
    held: ['p0.bin', 'p1.bin', 'p2.bin', 'proxy.bin'],
  });
  const proxyBytes = metadata.proxy!.bytes;
  assert.ok(proxyBytes > 8 * 1024 * 1024);
  const pageCache = createPageCache();
  const session = await openSession(metadata, pageCache);
  const { streamer } = session;
  const first = streamer.request(urls.slice(0, 2));
  await Promise.all(urls.slice(0, 2).map((url) => asked(base + url)));
  // Two pages in flight: the proxy is asked at once, not after them.
  const reading = session.context.readSceneProxy!();
  await asked(`${base}proxy.bin`);
  assert.equal(pageCache.keptBytes, proxyBytes, 'its announced bytes are reserved while in flight');
  assert.ok(pageCache.reservedBytes >= proxyBytes);
  // A page asked while the proxy is in flight is not held back by it.
  const third = streamer.request([urls[2]]);
  await asked(base + urls[2]);
  assert.equal(streamer.stats().loading, 3);
  release('proxy.bin');
  const proxy = await reading;
  assert.equal(proxy.triangles, triangles);
  assert.equal(streamer.stats().loading, 3, 'it landed while the pages were still in flight');
  for (const url of urls) release(url);
  await Promise.all([first, third]);
  const { loaded, bytesRead, cpuBytes } = streamer.stats();
  assert.deepEqual({ loaded, bytesRead }, { loaded: 3, bytesRead: 36 }, 'the page counters');
  assert.ok(cpuBytes >= proxyBytes, 'the CPU counter holds it');
  session.close();
});
