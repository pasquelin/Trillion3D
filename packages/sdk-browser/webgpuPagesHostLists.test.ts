// The two lists the host asks the WebGPU engine after the render: same addresses as a string-set
// dedup, and returned as-is while nothing they depend on has moved. The to-load page list no longer
// walks the cut: the delta holds the set of pages waiting for their bytes, and that is what is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestStamps, type PageRec } from './pageSelection.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createCutPending } from './webgpuCutPending.ts';
import { pageUrls, pendingUrls } from './webgpuPagesHostApi.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const rec = (url: string, requestIndex: number, chargee = true) =>
  ({ url, requestIndex, array: chargee ? new Uint32Array(3) : undefined }) as unknown as PageRec;

/** What the two lists read, and nothing else: a catalogue, three lists, two stamps. */
function banc() {
  const bootstrap = [rec('a', 0)];
  // Two placements of the same request key (ranks 2 and 3), and three pages without bytes.
  const packedPages = [
    rec('a', 0),
    rec('b', 1),
    rec('c', 2),
    rec('c', 2),
    rec('d', 3, false),
    rec('e', 4, false),
    rec('f', 5, false),
  ];
  packedPages.forEach((page, index) => (page.packedIndex = index));
  const shown = [packedPages[0], packedPages[1]];
  const desired: PageRec[] = [];
  const delta = createCutDelta(packedPages, desired);
  const cutPending = createCutPending(packedPages, delta);
  const run = {
    desired,
    shown,
    urlScratch: [] as string[],
    pendingScratch: [] as string[],
    hostPendingScratch: [] as string[],
    awaitedScratch: [] as PageRec[],
    coverageBudgetLimited: false,
    cutHeld: false,
    cutEpoch: 0,
    pageArrayEpoch: 0,
    pendingHeld: { epoch: -1, cut: -1, limited: false, ready: false },
    urlsHeld: { epoch: -1, cut: -1, limited: false },
  };
  const rt = {
    run,
    layout: { packedPages },
    setup: { bootstrap, requestStamps: new RequestStamps(6) },
    services: { bootstrapState: { ready: true }, cutPending },
  } as unknown as WebgpuPagesRuntime;
  /** A cut published as the engine publishes it: by its delta, readers included. */
  const publie = (ids: number[]) => {
    delta.apply(ids);
    cutPending.apply();
    run.cutEpoch++;
  };
  publie([1, 2, 3, 4]);
  return { rt, run, publie, cutPending, packedPages };
}

/** The old rule, word for word: a string set, in encounter order. */
const parEnsemble = (listes: readonly (readonly PageRec[])[]) => {
  const vus = new Set<string>(),
    urls: string[] = [];
  for (const liste of listes)
    for (const page of liste)
      if (!vus.has(page.url)) {
        vus.add(page.url);
        urls.push(page.url);
      }
  return urls;
};

test('render tracking writes into its own array, never into the held list', () => {
  const { rt, run } = banc();
  const attendue = pendingUrls(rt);
  run.cutHeld = true;
  // What `reportProgress` does every two seconds, into the array left to it.
  run.pendingScratch.length = 0;
  run.pendingScratch.push('intrus');
  assert.deepEqual(pendingUrls(rt), attendue, 'the held list was not overwritten');
});

test('both lists return what a string set returned, in the same order', () => {
  const { rt, run } = banc();
  assert.deepEqual(pageUrls(rt), parEnsemble([rt.setup.bootstrap, run.shown, run.desired]));
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd']);
  // Only pages without bytes are waited for, deduped the same way.
  assert.deepEqual(pendingUrls(rt), ['d']);
  // An exceeded budget drops the cut from both lists, without touching the rest.
  run.coverageBudgetLimited = true;
  assert.deepEqual(pageUrls(rt), ['a', 'b']);
  assert.deepEqual(pendingUrls(rt), []);
});

test('a held sample returns the list already yielded, and everything else remakes it', () => {
  const { rt, run, publie } = banc();
  const urls = pageUrls(rt),
    pending = pendingUrls(rt);
  // A held sample: the lists are not walked again, so a silently widened cut is ignored.
  run.cutHeld = true;
  const epoch = run.cutEpoch;
  publie([1, 2, 3, 4, 5]);
  run.cutEpoch = epoch;
  assert.deepEqual(pageUrls(rt), urls, "the returned list is the previous image's");
  assert.deepEqual(pendingUrls(rt), pending);
  // Bytes arrive or leave: the stamp advances and both lists start over.
  run.pageArrayEpoch++;
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(pendingUrls(rt), ['d', 'e']);
  // The budget flag flips: they start over too, held sample or not.
  run.coverageBudgetLimited = true;
  assert.deepEqual(pageUrls(rt), ['a', 'b']);
  assert.deepEqual(pendingUrls(rt), []);
  // A sample that is no longer held remakes everything, with nothing else to say so.
  run.coverageBudgetLimited = false;
  run.cutHeld = false;
  publie([1, 2, 3, 4]);
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pendingUrls(rt), ['d']);
});

test('an adoption that rewrites the lists after the fact ages them, even with a held sample after', () => {
  const { rt, run, publie } = banc();
  const urls = pageUrls(rt),
    pending = pendingUrls(rt);
  assert.deepEqual(urls, ['a', 'b', 'c', 'd']);
  // Flush replays an adoption AFTER the host has taken its lists: they move under it, and the next
  // image may well reread the same sample and believe it may hold them.
  publie([1, 2, 3, 4, 5]);
  run.cutHeld = true;
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd', 'e'], 'the stale list is not returned');
  assert.deepEqual(pendingUrls(rt), ['d', 'e']);
  assert.notDeepEqual(pending, ['d'], 'the held array was rewritten');
  // The same age and the same sample: there, and only there, the list is returned as-is.
  const epoch = run.cutEpoch;
  publie([1, 2, 3, 4, 5, 6]);
  run.cutEpoch = epoch;
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(pendingUrls(rt), ['d', 'e']);
});

test('bytes of a cut page make it enter and leave the wait', () => {
  const { rt, run, cutPending, packedPages } = banc();
  assert.deepEqual(pendingUrls(rt), ['d']);
  // Bytes arrive: the rank journal names the page, the waiting set empties.
  packedPages[4].array = new Uint32Array(3);
  cutPending.touch(4);
  run.pageArrayEpoch++;
  assert.deepEqual(pendingUrls(rt), []);
  // And leave: it comes back into the wait, without the cut having moved by one rank.
  packedPages[4].array = undefined;
  cutPending.touch(4);
  run.pageArrayEpoch++;
  assert.deepEqual(pendingUrls(rt), ['d']);
});

test('bootstrap coverage alone decides what the image waits for before it is ready', () => {
  const { rt, run } = banc();
  (rt.services.bootstrapState as { ready: boolean }).ready = false;
  run.cutHeld = true;
  assert.deepEqual(pendingUrls(rt), [], 'the root already holds its bytes');
  (rt.services.bootstrapState as { ready: boolean }).ready = true;
  assert.deepEqual(pendingUrls(rt), ['d'], 'the flip remakes the list despite the held sample');
});
