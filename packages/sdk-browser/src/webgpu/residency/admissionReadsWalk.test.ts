// The reads an admission pass starts ahead (#921, STR-08), walked alone: which pages, in which order,
// how many, and at which address the host's reader is asked for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createAdmissionReads } from './admission.ts';
import { pageOf } from './residentEnsurer.fixture.ts';
import { readGeometryAhead } from '../row/pageSlots.ts';

/** The walk over `pages`, `leaf` under `root`: the urls it starts, in order, for `limit`. */
function walked(options: { limit: number; resident?: string[]; without?: string[] }) {
  const [root, leaf, other, last] = ['root', 'leaf', 'other', 'last'].map(pageOf);
  const started: string[] = [];
  const reads = createAdmissionReads({
    hasBytes: (page) => !options.without?.includes(page.url),
    parentsOf: (page) => (page === leaf ? [root] : []),
    prefetch: (page, signal) => (assert.equal(signal.aborted, false), started.push(page.url)),
  });
  const pool = { get: (url: string) => (options.resident?.includes(url) ? {} : undefined) };
  const signal = new AbortController().signal;
  reads([leaf, other, leaf, last], options.limit, (page) => page !== last, pool as never, signal);
  return started;
}

test('a pass reads its pages in admission order, parents first, each once, up to its limit', () => {
  assert.deepEqual(walked({ limit: 8 }), ['root', 'leaf', 'other'], 'the refused page is not read');
  assert.deepEqual(walked({ limit: 2 }), ['root', 'leaf'], 'the limit counts the parents');
  assert.deepEqual(walked({ limit: 1 }), ['root'], 'a parent read, then the limit');
  assert.deepEqual(walked({ limit: 0 }), [], 'no slot, no read');
  assert.deepEqual(walked({ limit: 8, resident: ['root'] }), ['leaf', 'other'], 'held: not read');
  assert.deepEqual(walked({ limit: 8, without: ['root'] }), ['other'], 'no read past a parent');
  assert.deepEqual(walked({ limit: 8, without: ['other'] }), ['root', 'leaf']);
});

test('a cluster is read ahead at its geometry page, a cluster without one not at all', () => {
  const asked: [string, AbortSignal | undefined][] = [];
  const geometryUrls = new Map([
    ['shared.wgp', 'objects/shared.bin'],
    ['own', 'objects/own.bin'],
  ]);
  const readAhead = readGeometryAhead(geometryUrls, async (url, signal) => {
    asked.push([url, signal]);
    throw new Error('a failed read is the admission’s to report');
  });
  const signal = new AbortController().signal;
  const shared = { ...pageOf('cluster'), geometryPage: { url: 'shared.wgp' } } as PageRec;
  for (const page of [shared, pageOf('own'), pageOf('in-memory')]) readAhead(page, signal);
  assert.deepEqual(asked, [
    ['objects/shared.bin', signal],
    ['objects/own.bin', signal],
  ]);
});
