import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { createGeometryBudget } from './pool.ts';

export const PAGE = 100;

/** A catalogue of `count` pages of `PAGE` decoded bytes, and a store that holds what arrives. */
export function fixture(
  count: number,
  options: { budgetBytes?: number; rootPages?: number; maxResidentPages?: number } = {},
) {
  const descriptors = new Map<string, GeometryPageDescriptor>();
  for (let i = 0; i < count; i++)
    descriptors.set(`p${i}`, { uncompressedBytes: PAGE } as GeometryPageDescriptor);
  const rootUrls = new Set<string>();
  for (let i = 0; i < (options.rootPages ?? 0); i++) rootUrls.add(`r${i}`);
  const state = { allocationBytes: 0 },
    resident = new Set<string>(),
    kept: string[] = [],
    dropped: string[] = [];
  let keptCalls = 0,
    rootBytes = 0,
    rootReads = 0;
  const pool = createGeometryBudget({
    budgetBytes: options.budgetBytes,
    maxResidentPages: options.maxResidentPages,
    descriptors,
    rootUrls,
    state,
    rootBytes: () => {
      rootReads++;
      return rootBytes;
    },
    kept: () => {
      keptCalls++;
      return kept;
    },
    drop: (url) => {
      if (!resident.delete(url)) return;
      state.allocationBytes -= PAGE;
      dropped.push(url);
    },
  });
  const arrive = (url: string) => {
    if (!resident.has(url)) state.allocationBytes += PAGE;
    resident.add(url);
    pool.arrived(url);
  };
  /** The root cover now holds `bytes`, outside the order — prepare, an instance added or removed. */
  const root = (bytes: number) => {
    state.allocationBytes += bytes - rootBytes;
    rootBytes = bytes;
    pool.rootsChanged();
  };
  return {
    pool,
    state,
    resident,
    kept,
    dropped,
    arrive,
    root,
    keptCalls: () => keptCalls,
    rootReads: () => rootReads,
  };
}

/** Records of a cut: `count` records drawn from `pages` distinct pages. */
export const records = (count: number, pages = count) =>
  Array.from({ length: count }, (_, i) => ({ url: `p${i % pages}` }) as PageRec);
