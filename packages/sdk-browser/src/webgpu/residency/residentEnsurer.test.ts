import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts';
import { UPLOAD_SLICE_MS } from '../../backend/common.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { surfaceOf } from '../../page/surface.ts';

/** Fields the residency ensurer never reads: shared across every fixture page. */
const DUMMY_MATRIX = new THREE.Matrix4();
const DUMMY_ATTRIBUTES: THREE.BufferGeometry['attributes'] = {};
const DUMMY_BOUNDS: number[] = [0, 0, 0];
const pageOf = (url: string): PageRec => ({
  id: 0,
  url,
  clusterId: url,
  array: new Uint32Array(1),
  triangles: 0,
  indexBytes: 0,
  min: DUMMY_BOUNDS,
  max: DUMMY_BOUNDS,
  depthLayer: 0,
  attributes: DUMMY_ATTRIBUTES,
  material: surfaceOf([]),
  declaration: [],
  matrix: DUMMY_MATRIX,
  renderOrder: 0,
  attached: true,
});

/** A cache of three slots all pinned: the fourth page cannot enter. */
function saturatedCache(resident: string[], error = 'ALL_PAGES_PINNED') {
  const held = new Set(resident);
  return {
    get: (url: string) => (held.has(url) ? { key: url } : undefined),
    async load(url: string) {
      if (held.size >= 3) throw new Error(error);
      held.add(url);
    },
    pin() {},
  };
}

const ensurer = (tracking: ReturnType<typeof createWebgpuPageTracking>, cache: unknown) =>
  createWebgpuResidentEnsurer({
    getCache: () => cache as never,
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    hasBytes: () => true,
    isLost: () => false,
    traceEnabled: false,
    traceDiagnostic: () => {},
    shadowPages: () => [],
  });

test('a full pool stops the burst without dropping the image; any other error bubbles up', async () => {
  const pages = ['a', 'b', 'c', 'd', 'e'].map(pageOf);
  const tracking = createWebgpuPageTracking(pages);
  for (const page of pages) tracking.wanted.add(tracking.keyOf(page), page);
  const cache = saturatedCache(['a', 'b']);
  await ensurer(tracking, cache)(pages, 1, 1);
  // `c` entered (third slot), `d` found the pool full: the burst stops, `d` and `e` stay wanted and
  // outside — they display through their resident ancestor, and cut admission reads the state
  // (`keepCount > slots`) to grow the screen error.
  assert.ok(cache.get('c'));
  assert.equal(cache.get('d'), undefined);
  await assert.rejects(
    ensurer(tracking, saturatedCache(['a', 'b', 'c'], 'WEBGPU_LOST'))([pages[3]], 2, 2),
    /WEBGPU_LOST/,
  );
});

/** A pool of `slots` pages evicting its oldest unpinned page, as the GPU page cache does. */
function lruCache(slots: number) {
  const resident = new Map<string, { key: string }>(),
    pins = new Set<string>();
  return {
    resident,
    pins,
    get: (url: string) => resident.get(url),
    async load(url: string) {
      if (resident.size >= slots) {
        const victim = [...resident.keys()].find((key) => !pins.has(key));
        if (victim === undefined) throw new Error('ALL_PAGES_PINNED');
        resident.delete(victim);
      }
      resident.set(url, { key: url });
    },
    pin: (url: string) => pins.add(url),
    touch(url: string) {
      const page = resident.get(url);
      if (!page) return false;
      resident.delete(url);
      resident.set(url, page);
      return true;
    },
    unpinnedSlots: () => slots - pins.size,
  };
}

test('shadow casters fill only what the camera leaves: never pinned, never evicting its pages', async () => {
  const pages = ['cam0', 'cam1', 'cam2', 'old', 'sh0', 'sh1', 'sh2'].map(pageOf);
  const [cam0, cam1, cam2, , sh0, sh1, sh2] = pages;
  const tracking = createWebgpuPageTracking(pages);
  for (const page of [cam0, cam1]) tracking.wanted.add(tracking.keyOf(page), page);
  const cache = lruCache(4);
  await cache.load('old');
  await cache.load('sh0');
  let lower = [sh0, sh1, sh2];
  const ensure = createWebgpuResidentEnsurer({
    getCache: () => cache as never,
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    hasBytes: () => true,
    isLost: () => false,
    traceEnabled: false,
    traceDiagnostic: () => {},
    shadowPages: () => lower,
  });
  await ensure([cam0, cam1], 1, 1);
  // The camera's two pages took the two free slots and are pinned; `old` and `sh0` remain.
  // Two unpinned slots, one of them already a caster: one more caster enters, in `old`'s slot.
  assert.deepEqual([...cache.resident.keys()].sort(), ['cam0', 'cam1', 'sh0', 'sh1']);
  assert.deepEqual([...cache.pins].sort(), ['cam0', 'cam1'], 'no caster is pinned');
  // The camera wants a third page: it takes a caster's slot, and the casters still wanted keep
  // theirs — the one left over is not evicted for another caster.
  tracking.wanted.add(tracking.keyOf(cam2), cam2);
  lower = [sh1, sh2];
  await ensure([cam0, cam1, cam2], 2, 2);
  assert.ok(cache.get('cam2'), 'the camera page entered');
  assert.equal(cache.get('sh0'), undefined, 'by the slot of a caster');
  assert.ok(cache.get('sh1'), 'the caster still wanted stays');
  assert.equal(cache.get('sh2'), undefined, 'and no other caster takes its place');
});

test('a job that slices its caster uploads posts them all before it resolves', async () => {
  const pages = ['sh0', 'sh1', 'sh2'].map(pageOf);
  const tracking = createWebgpuPageTracking(pages);
  // Every load outlasts the slice: each caster ends one, and the job must resume after it.
  let clock = 0;
  mock.method(performance, 'now', () => clock);
  try {
    const cache = lruCache(8),
      load = cache.load;
    cache.load = async (url: string) => {
      clock += UPLOAD_SLICE_MS;
      await load(url);
    };
    // A task queued before the job runs between two slices: the job yields to the event loop.
    let seen = -1;
    setImmediate(() => (seen = cache.resident.size));
    await createWebgpuResidentEnsurer({
      getCache: () => cache as never,
      tracking,
      bootstrapKey: new Uint8Array(tracking.keyCount),
      hasBytes: () => true,
      isLost: () => false,
      traceEnabled: false,
      traceDiagnostic: () => {},
      shadowPages: () => pages,
    })([], 1, 1);
    assert.equal(cache.resident.size, 3, 'every caster posted when the job resolves');
    assert.ok(seen >= 1 && seen < 3, `the job yielded between slices (${seen} posted then)`);
  } finally {
    mock.restoreAll();
  }
});

// A report taken while the tier loads rewrites its list in place: the load keeps the list it began
// with, so which casters end resident depends on no timing.
test('the tier loads the list it began with, whatever a report rewrites meanwhile', async () => {
  const pages = ['a', 'b', 'c', 'd'].map(pageOf);
  const [a, b, c, d] = pages;
  const tracking = createWebgpuPageTracking(pages);
  const cache = lruCache(3),
    load = cache.load;
  const live = [a, b, c, d];
  cache.load = async (url: string) => {
    await load(url);
    live.splice(0, live.length, a, d, b, c);
  };
  await createWebgpuResidentEnsurer({
    getCache: () => cache as never,
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    hasBytes: () => true,
    isLost: () => false,
    traceEnabled: false,
    traceDiagnostic: () => {},
    shadowPages: () => live,
  })([], 1, 1);
  assert.deepEqual([...cache.resident.keys()].sort(), ['a', 'b', 'c']);
});
