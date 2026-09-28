// Geometry pages over a real network (#921): the reference scene served over HTTP as the docs
// server serves it, opened once as is and once through Chrome's network emulation (60 ms round
// trip, 30 Mb/s). Asserts what the page reads promise, never how long they take: the reads an
// admission pass waits for overlap on the network (#997), the pool ends up with the same pages, the
// view ahead looks a round trip further (#999), and the cache objects arrive brotli-encoded (#999).
// `NETWORK_PROOF_DIST` runs another build's engine against the same assertions.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { launchChrome } from '../../../bench/runner/chrome.ts';
import { resolveMounts } from '../../../bench/runner/options.ts';
import { assetsManifest, DEFAULT_SCENE } from '../../../bench/runner/scene.ts';
import { startServer } from '../../kit/server/staticServer.ts';
import { isCacheObject } from '../../../scripts/compress-cache-objects.ts';
import { PREFETCH_HORIZON_MS } from '../../../packages/sdk-browser/src/backend/common.ts';
import { readOverNetwork } from '../support/geometryNetworkPage.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const DIST = resolve(ROOT, process.env.NETWORK_PROOF_DIST ?? 'dist');
const LATENCY_MS = 60;
const VIEWPORT = { width: 1280, height: 800 };
/** The emulated network: `LATENCY_MS` round trip, 30 Mb/s each way. */
const THROTTLE = {
  offline: false,
  latency: LATENCY_MS,
  downloadThroughput: 30e6 / 8,
  uploadThroughput: 30e6 / 8,
};

/** One cache object's transfer as Chrome's network stack saw it, on its own clock; `answered` once
 *  its response came, so a read aborted before it (the view moved on) says nothing of its encoding. */
type Transfer = { sent: number; done: number; answered: boolean; encoding?: string };

/** How many transfers were sent while another was still in flight: reads issued one after the
 *  other's end count none, reads issued together all but the first. */
const sentAlongside = (transfers: readonly Transfer[]) =>
  transfers.filter((t) => transfers.some((o) => o !== t && o.sent <= t.sent && o.done > t.sent))
    .length;

const mounts = [...resolveMounts(ROOT, []), { prefix: '/dist/', dir: DIST }];
const { server, port } = await startServer({ mounts, compress: isCacheObject });
const browser = await launchChrome({ headless: true });

/** The scene opened in a fresh context, `throttled` or not: what the page read, and the transfers. */
async function open(throttled: boolean) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => void (m.type() === 'error' && errors.push(m.text())));
  const cdp = await context.newCDPSession(page);
  const transfers = new Map<string, Transfer>();
  cdp.on('Network.requestWillBeSent', ({ requestId, request, timestamp }) => {
    if (isCacheObject(new URL(request.url).pathname))
      transfers.set(requestId, { sent: timestamp, done: Infinity, answered: false });
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const transfer = transfers.get(requestId);
    if (!transfer) return;
    transfer.answered = true;
    transfer.encoding = response.headers['content-encoding'];
  });
  const end = ({ requestId, timestamp }: { requestId: string; timestamp: number }) => {
    const transfer = transfers.get(requestId);
    if (transfer) transfer.done = timestamp;
  };
  cdp.on('Network.loadingFinished', end);
  cdp.on('Network.loadingFailed', end);
  await cdp.send('Network.enable');
  if (throttled) await cdp.send('Network.emulateNetworkConditions', THROTTLE);
  await page.goto(`http://127.0.0.1:${port}/`);
  const reading = await page.evaluate(readOverNetwork, {
    sdkUrl: '/dist/witnesses/measurement.js',
    posesUrl: '/runner/poses.ts',
    manifestUrl: assetsManifest(DEFAULT_SCENE, true),
    poses: 24,
    holdMs: 300_000,
    ...VIEWPORT,
  });
  await context.close();
  const sent = [...transfers.values()];
  return {
    ...reading,
    errors: [...errors, ...reading.failures],
    transfers: sent,
    alongside: sentAlongside(sent),
    farthest: Math.max(...reading.horizons),
  };
}

try {
  const fast = await open(false),
    slow = await open(true);
  for (const [name, r] of Object.entries({ fast, slow })) {
    console.log(
      `${name}: ${r.admitted.length} admitted, ${r.alongside}/${r.transfers.length} reads sent ` +
        `alongside another, horizon up to ${r.farthest} ms, encodings ` +
        `${[...new Set(r.transfers.filter((t) => t.answered).map((t) => t.encoding ?? 'identity'))]}, held ${r.held}, ` +
        `errors ${r.errors.join(' | ') || 'none'}`,
    );
    assert.deepEqual(r.errors, []);
    assert.ok(r.held, 'the still image is held');
  }
  // #997: an admission pass starts the reads it will wait for before it admits the first, so they
  // share the network; one read at a time leaves a read alone on it.
  assert.ok(
    slow.alongside * 2 > slow.transfers.length,
    'most geometry page reads are sent while another is in flight',
  );
  for (const r of [fast, slow])
    assert.ok(
      r.horizons.length && r.horizons.every(Number.isFinite),
      'frames trace aheadHorizonMs',
    );
  assert.deepEqual(
    [...slow.admitted].sort(),
    [...fast.admitted].sort(),
    'the pool admits the same pages',
  );
  // #999: the view ahead adds the measured round trip, which the emulation keeps above its latency.
  assert.ok(slow.farthest >= PREFETCH_HORIZON_MS + LATENCY_MS, 'the horizon adds the round trip');
  assert.ok(fast.farthest < slow.farthest, 'a nearer network looks less far ahead');
  const answered = slow.transfers.filter((t) => t.answered);
  assert.ok(
    answered.length > 0 && answered.every((t) => t.encoding === 'br'),
    'the cache objects arrive brotli-encoded',
  );
} finally {
  await browser.close();
  server.close();
}
