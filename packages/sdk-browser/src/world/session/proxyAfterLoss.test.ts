import test from 'node:test';
import assert from 'node:assert/strict';
import { base, openSession, servedScene } from './proxySession.fixture.ts';
import { createPageCache, manifestTableBytes } from '../../streaming/pageCache.ts';

const proxyUrl = `${base}proxy.bin`;

test('a session reopened after a device loss reads the resident proxy from the kept cache, fetching it once', async () => {
  const { metadata, fetched } = await servedScene(0);
  const pageCache = createPageCache();
  const before = await openSession(metadata, pageCache);
  // The bounce and the far shadow may both ask: one read serves them.
  const [lit] = await Promise.all([
    before.context.readSceneProxy!(),
    before.context.readSceneProxy!(),
  ]);
  assert.equal(lit.triangles, 1);
  assert.deepEqual(fetched, [proxyUrl]);
  // The device is lost: the session closes, the world keeps its cache and opens another.
  before.close();
  const after = await openSession(metadata, pageCache);
  const relit = await after.context.readSceneProxy!();
  assert.deepEqual(fetched, [proxyUrl], 'the proxy it held is not fetched again');
  assert.deepEqual(relit.data.triangles, lit.data.triangles);
  assert.equal(pageCache.keptBytes, metadata.proxy!.bytes, 'its bytes count against the CPU total');
  after.close();
});

test('pages that outgrow the CPU total never evict the kept proxy: a device loss fetches it no more', async () => {
  const { metadata, urls, fetched } = await servedScene(6);
  const transfer = 64;
  // Room for the tables, one transfer, the proxy and two pages: fewer than the six read.
  const cpu = manifestTableBytes(metadata.primitives[0].pages) + transfer + metadata.proxy!.bytes;
  const pageCache = createPageCache(cpu + 2 * 12);
  const before = await openSession(metadata, pageCache, { maxPageTransferBytes: transfer });
  await before.context.readSceneProxy!();
  for (const url of urls) await before.streamer.request([url]);
  assert.ok(before.streamer.stats().evictions >= 4, 'the pages churned through the total');
  assert.ok(before.streamer.stats().cpuBytes <= pageCache.cpuBytes);
  before.close();
  const after = await openSession(metadata, pageCache, { maxPageTransferBytes: transfer });
  await after.context.readSceneProxy!();
  assert.equal(fetched.filter((url) => url === proxyUrl).length, 1, 'the proxy was kept');
  after.close();
});

test('another scene the world loads reads its own proxy, and the one it kept leaves', async () => {
  const { metadata, fetched } = await servedScene(0);
  const pageCache = createPageCache();
  const first = await openSession(metadata, pageCache);
  await first.context.readSceneProxy!();
  first.close();
  const other = 'http://localhost/other/';
  const second = await openSession(metadata, pageCache, { root: other });
  assert.equal(pageCache.keptBytes, 0, "the first scene's proxy left with it");
  await second.context.readSceneProxy!();
  assert.deepEqual(fetched, [proxyUrl, `${other}proxy.bin`]);
  second.close();
});

test('a proxy whose bytes are not the announced ones fails, naming the file and what differs', async () => {
  const { metadata } = await servedScene(0);
  const announced = '0'.repeat(64);
  metadata.proxy!.sha256 = announced;
  const pageCache = createPageCache();
  const session = await openSession(metadata, pageCache);
  await assert.rejects(session.context.readSceneProxy!(), {
    code: 'INVALID_CACHE',
    message: new RegExp(`SHA-256 [0-9a-f]{64}, ${announced} announced`),
  });
  assert.equal(pageCache.keptBytes, 0, 'what failed reserves nothing');
  session.close();
});

test('a missing proxy is asked once, as a 404 another request would meet again', async () => {
  const { metadata, fetched } = await servedScene(0, { missing: ['proxy.bin'] });
  const session = await openSession(metadata, createPageCache());
  await assert.rejects(session.context.readSceneProxy!(), { code: 'RESOURCE_HTTP_ERROR' });
  assert.deepEqual(fetched, [proxyUrl]);
  session.close();
});

test('a session reopened while the proxy is in flight joins that read, fetching it once', async () => {
  const { metadata, fetched, asked, release } = await servedScene(0, { held: ['proxy.bin'] });
  const pageCache = createPageCache();
  const before = await openSession(metadata, pageCache);
  const lost = before.context.readSceneProxy!();
  await asked(proxyUrl);
  before.close();
  const after = await openSession(metadata, pageCache);
  const relit = after.context.readSceneProxy!();
  release('proxy.bin');
  await Promise.all([lost, relit]);
  assert.deepEqual(fetched, [proxyUrl]);
  assert.equal(pageCache.keptBytes, metadata.proxy!.bytes);
  after.close();
});

test('a proxy that lands after another scene was loaded is not kept', async () => {
  const { metadata, asked, release } = await servedScene(0, { held: ['proxy.bin'] });
  const pageCache = createPageCache();
  const first = await openSession(metadata, pageCache);
  const late = first.context.readSceneProxy!();
  await asked(proxyUrl);
  first.close();
  const second = await openSession({ ...metadata, proxy: undefined }, pageCache);
  release('proxy.bin');
  await assert.rejects(late, { name: 'AbortError' }, 'the read of a scene gone is cancelled');
  assert.equal(pageCache.keptBytes, 0, "the first scene's proxy does not come back");
  second.close();
});

test('a session closed on a device loss while the proxy is in flight leaves its read to the next one', async () => {
  const { metadata, fetched, asked, release } = await servedScene(0, { held: ['proxy.bin'] });
  const pageCache = createPageCache();
  const lost = new AbortController();
  const before = await openSession(metadata, pageCache, { signal: lost.signal });
  void before.context.readSceneProxy!().catch(() => {});
  await asked(proxyUrl);
  // The world closes the lost session, cancelling what that session asked.
  lost.abort();
  before.close();
  const after = await openSession(metadata, pageCache);
  const relit = after.context.readSceneProxy!();
  release('proxy.bin');
  assert.equal((await relit).triangles, 1);
  assert.deepEqual(fetched, [proxyUrl], 'the read in flight was not cancelled with its session');
  after.close();
});

test('a proxy cooked again at the same address and size is read again, not served from the kept one', async () => {
  const { metadata, fetched } = await servedScene(0);
  const pageCache = createPageCache();
  const first = await openSession(metadata, pageCache);
  await first.context.readSceneProxy!();
  first.close();
  const recooked = { ...metadata, proxy: { ...metadata.proxy!, sha256: '1'.repeat(64) } };
  const second = await openSession(recooked, pageCache);
  // The server still holds the old bytes: read again, they are refused, never taken as the new ones.
  await assert.rejects(second.context.readSceneProxy!(), { code: 'INVALID_CACHE' });
  assert.deepEqual(fetched, [proxyUrl, proxyUrl]);
  second.close();
});

test('a CPU total too small for the proxy beside the pages a frame keeps: the proxy yields, never the pages', async () => {
  const { metadata, urls } = await servedScene(4);
  const transfer = 64;
  // Room for the tables, one transfer and the four pages, not for the proxy beside them.
  const cpu = manifestTableBytes(metadata.primitives[0].pages) + transfer + 4 * 12;
  const pageCache = createPageCache(cpu);
  const heard: string[] = [];
  const session = await openSession(metadata, pageCache, {
    maxPageTransferBytes: transfer,
    diagnostics: (diagnostic) => heard.push(diagnostic.phase),
  });
  session.streamer.retain(urls);
  await session.streamer.request(urls);
  const lit = await session.context.readSceneProxy!();
  assert.equal(lit.triangles, 1, 'the bounce still gets its proxy');
  assert.equal(pageCache.keptBytes, 0, 'the proxy gave its bytes back');
  assert.ok(
    urls.every((url) => session.streamer.has(url)),
    'every page the frame keeps stays',
  );
  assert.equal(session.streamer.stats().evictions, 0);
  await session.flush();
  assert.ok(heard.includes('page-cache-kept-yielded'), 'a notice says the proxy yielded');
  session.close();
});
