import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import { createGeometryBudget, type PageCopies } from './pool.ts';
import type { BackendDiagnostic } from '../types.ts';

export const PAGE = 100;

/** A catalogue of `count` pages of `PAGE` decoded bytes, each held in `copies` copies until
 *  `instances` changes them, and a store that holds what arrives. */
export function fixture(
  count: number,
  options: {
    budgetBytes?: number;
    ceilingBytes?: number;
    rootPages?: number;
    maxResidentPages?: number;
    copies?: number;
  } = {},
) {
  const descriptors = new Map<string, GeometryPageDescriptor>();
  for (let i = 0; i < count; i++)
    descriptors.set(`p${i}`, { uncompressedBytes: PAGE } as GeometryPageDescriptor);
  const rootUrls = new Set<string>();
  for (let i = 0; i < (options.rootPages ?? 0); i++) rootUrls.add(`r${i}`);
  const state = { allocationBytes: 0 },
    resident = new Set<string>(),
    kept = new Set<string>(),
    dropped: string[] = [];
  let keptCalls = 0,
    rootBytes = 0,
    rootReads = 0,
    each = options.copies ?? 1,
    revision = 0;
  const copies: PageCopies = {
    of: () => each,
    root: () => rootUrls.size * each,
    scene: () => count * each,
  };
  const diagnostics: BackendDiagnostic[] = [];
  const pool = createGeometryBudget({
    budgetBytes: options.budgetBytes,
    ceilingBytes: options.ceilingBytes,
    maxResidentPages: options.maxResidentPages,
    descriptors,
    rootUrls,
    copies,
    coverRevision: () => revision,
    state,
    floorBytes: () => {
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
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const arrive = (url: string) => {
    if (!resident.has(url)) state.allocationBytes += PAGE;
    resident.add(url);
    pool.arrived(url);
  };
  /** What nothing may evict now holds `bytes`, outside the order — prepare, an instance added or
   *  removed, a page the host replaced. */
  const root = (bytes: number) => {
    state.allocationBytes += bytes - rootBytes;
    rootBytes = bytes;
  };
  /** Instances now hold `copies` copies of every page. */
  const instances = (copiesPerPage: number) => {
    each = copiesPerPage;
    revision++;
  };
  return {
    pool,
    state,
    resident,
    kept,
    dropped,
    arrive,
    root,
    instances,
    diagnostics,
    keptCalls: () => keptCalls,
    rootReads: () => rootReads,
  };
}
