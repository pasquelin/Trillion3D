import * as THREE from 'three';

export function drawnIndices(mesh: THREE.Mesh) {
  const index = mesh.geometry.getIndex();
  if (!index) return [];
  const batch = mesh as THREE.Mesh & {
    isBatchedMesh?: boolean;
    _multiDrawStarts?: Int32Array;
    _multiDrawCounts?: Int32Array;
    _multiDrawCount?: number;
  };
  if (!batch.isBatchedMesh || !batch._multiDrawStarts) return Array.from(index.array);
  const out: number[] = [];
  for (let draw = 0; draw < (batch._multiDrawCount ?? 0); draw++) {
    const first = batch._multiDrawStarts[draw] / Uint32Array.BYTES_PER_ELEMENT,
      length = batch._multiDrawCounts![draw];
    for (let i = first; i < first + length; i++) out.push(index.getX(i));
  }
  return out;
}

export function drawnTriangles(scene: THREE.Object3D) {
  let total = 0;
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) total += drawnIndices(object as THREE.Mesh).length / 3;
  });
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
