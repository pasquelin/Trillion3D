import type { RenderBackend } from './backendTypes.ts';
import type { ClusterDraw } from './clusterBatches.ts';
import { drawnRanges, submittedDraws } from './clusterBatchMesh.ts';

/** Indices one submission draws, in submission order: the ranges of a batch record, the whole
 *  index of a page mesh. */
export function drawnIndices(draw: ClusterDraw) {
  const index = draw.geometry.getIndex();
  if (!index) return [];
  const out: number[] = [];
  for (const [first, length] of drawnRanges(draw))
    for (let i = first; i < first + length; i++) out.push(index.getX(i));
  return out;
}

/** Triangles the owner submits for the current cut. */
export function drawnTriangles(backend: RenderBackend) {
  let total = 0;
  for (const draw of submittedDraws(backend)) total += drawnIndices(draw).length / 3;
  return total;
}

export type Cluster = {
  id: number;
  url: string;
  count: number;
  min: number[];
  max: number[];
  bytes: number;
  sha256: string;
  role?: 'exact' | 'coarse';
  start?: number;
};

export function clusterSphere(page: { min: number[]; max: number[] }) {
  const c = [0, 1, 2].map((i) => (page.min[i] + page.max[i]) / 2);
  return [...c, Math.hypot(...[0, 1, 2].map((i) => page.max[i] - c[i])) || 1];
}

export function dagRoots(pages: Cluster[], starts?: number[]) {
  return {
    pages: pages.map((page, index) => ({
      ...page,
      role: 'exact' as const,
      start: starts?.[index] ?? index * 3,
      level: 0,
      lodError: 0,
      sphere: clusterSphere(page),
      parentError: null,
      parentSphere: null,
      group: null,
      source: null,
    })),
    structure: { version: 1, roots: pages.map((_, index) => index), groups: [] },
  };
}

export function dagLevel(
  leaves: Cluster[],
  coarse: Cluster[],
  error: number,
  roots: Cluster[] = [],
) {
  const sphere = coarse.length ? clusterSphere(coarse[0]) : [0, 0, 0, 1];
  const byId = (page: Cluster) => page.id;
  return {
    pages: [
      ...leaves.map((page) => ({
        ...page,
        role: 'exact' as const,
        start: page.start ?? page.id * 3,
        level: 0,
        lodError: 0,
        sphere: clusterSphere(page),
        parentError: error,
        parentSphere: sphere,
        group: 0,
        source: null,
      })),
      ...coarse.map((page) => ({
        ...page,
        role: 'coarse' as const,
        start: page.start ?? 0,
        level: 1,
        lodError: error,
        sphere,
        parentError: null,
        parentSphere: null,
        group: null,
        source: 0,
      })),
      ...roots.map((page) => ({
        ...page,
        role: 'exact' as const,
        start: page.start ?? page.id * 3,
        level: 0,
        lodError: 0,
        sphere: clusterSphere(page),
        parentError: null,
        parentSphere: null,
        group: null,
        source: null,
      })),
    ].sort((a, b) => a.id - b.id),
    structure: {
      version: 1,
      roots: [...coarse, ...roots].map(byId),
      groups: coarse.length
        ? [{ level: 1, error, sphere, children: leaves.map(byId), outputs: coarse.map(byId) }]
        : [],
    },
  };
}

export const DAG = { errorModel: 'dag-group-qem-v1', clusterStrategy: 'dag-groups' as const };
