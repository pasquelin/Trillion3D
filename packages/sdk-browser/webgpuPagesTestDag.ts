/** The screen-error band every cluster of a DAG cache carries, derived from its own box. */
export function clusterSphere(page: { min: number[]; max: number[] }) {
  const c = [0, 1, 2].map((i) => (page.min[i] + page.max[i]) / 2);
  return [...c, Math.hypot(...[0, 1, 2].map((i) => page.max[i] - c[i])) || 1];
}

/** Level-0 clusters that nothing replaces: the smallest legal DAG, one root per cluster. */
export function dagRoots<T extends { id: number; min: number[]; max: number[] }>(pages: T[]) {
  return pages.map((page) => ({
    ...page,
    role: 'exact' as const,
    start: page.id * 3,
    level: 0,
    lodError: 0,
    sphere: clusterSphere(page),
    parentError: null,
    parentSphere: null,
    group: null,
    source: null,
  }));
}

/** `leaves` replaced by one coarse cluster of error `error`: the smallest two-level DAG. */
export function dagLevel<T extends { id: number; min: number[]; max: number[] }>(
  leaves: T[],
  coarse: T,
  error: number,
) {
  const sphere = clusterSphere(coarse);
  return {
    pages: [
      ...leaves.map((page) => ({
        ...page,
        role: 'exact' as const,
        start: page.id * 3,
        level: 0,
        lodError: 0,
        sphere: clusterSphere(page),
        parentError: error,
        parentSphere: sphere,
        group: 0,
        source: null,
      })),
      {
        ...coarse,
        role: 'coarse' as const,
        start: 0,
        level: 1,
        lodError: error,
        sphere,
        parentError: null,
        parentSphere: null,
        group: null,
        source: 0,
      },
    ],
    structure: {
      version: 1,
      roots: [coarse.id],
      groups: [
        { level: 1, error, sphere, children: leaves.map((page) => page.id), outputs: [coarse.id] },
      ],
    },
  };
}
