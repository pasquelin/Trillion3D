import { IDENTITY_MATRIX4 } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { surfaceOf } from '../../page/surface.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts';

/** Fields the residency ensurer never reads: shared across every fixture page. */
const IDENTITY = { elements: IDENTITY_MATRIX4 };
const DUMMY_BOUNDS: number[] = [0, 0, 0];
/** An engine page record keyed by `url`. The host-side fields stay absent: the ensurer reads
 *  the engine record alone, and a fixture of the engine path carries no host library. */
export const pageOf = (url: string) =>
  ({
    id: 0,
    url,
    clusterId: url,
    array: new Uint32Array(1),
    triangles: 0,
    indexBytes: 0,
    min: DUMMY_BOUNDS,
    max: DUMMY_BOUNDS,
    depthLayer: 0,
    material: surfaceOf([]),
    matrix: IDENTITY,
    renderOrder: 0,
    attached: true,
  }) as unknown as PageRec;

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

/** An ensurer's options over `cache`: no cover, every page's bytes at hand, no parents, no tier. */
export const ensurerOptions = (
  tracking: ReturnType<typeof createWebgpuPageTracking>,
  cache: unknown,
): Parameters<typeof createWebgpuResidentEnsurer>[0] => ({
  getCache: () => cache as never,
  tracking,
  bootstrapKey: new Uint8Array(tracking.keyCount),
  hasBytes: () => true,
  parentsOf: () => [],
  isLost: () => false,
  traceEnabled: false,
  traceDiagnostic: () => {},
  lowerTiers: () => [],
});

/** An ensurer over `cache` whose caster tier is `shadowPages`, and whose tier ahead is `aheadPages`. */
export const tierEnsurer = (
  tracking: ReturnType<typeof createWebgpuPageTracking>,
  cache: unknown,
  shadowPages: () => readonly PageRec[],
  aheadPages: () => readonly PageRec[] = () => [],
) =>
  createWebgpuResidentEnsurer({
    ...ensurerOptions(tracking, cache),
    lowerTiers: () => [shadowPages(), aheadPages()],
  });
