import * as THREE from 'three';
import type { PageRec } from '../../page/selection/selection.ts';
import { surfaceOf } from '../../page/surface.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts';

/** Fields the residency ensurer never reads: shared across every fixture page. */
const DUMMY_MATRIX = new THREE.Matrix4();
const DUMMY_ATTRIBUTES: THREE.BufferGeometry['attributes'] = {};
const DUMMY_BOUNDS: number[] = [0, 0, 0];
export const pageOf = (url: string): PageRec => ({
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

/** A pool of `slots` pages evicting its oldest unpinned page, as the GPU page cache does. */
export function lruCache(slots: number) {
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

/** An ensurer over `cache` whose caster tier is `shadowPages`. */
export const tierEnsurer = (
  tracking: ReturnType<typeof createWebgpuPageTracking>,
  cache: unknown,
  shadowPages: () => readonly PageRec[],
) =>
  createWebgpuResidentEnsurer({
    getCache: () => cache as never,
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    hasBytes: () => true,
    isLost: () => false,
    traceEnabled: false,
    traceDiagnostic: () => {},
    shadowPages,
  });
