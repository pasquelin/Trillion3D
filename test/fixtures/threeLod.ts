type Cluster = {
  id: number;
  url: string;
  count: number;
  min: number[];
  max: number[];
  bytes: number;
  sha256: string;
  start?: number;
};
export const DAG = { errorModel: 'dag-group-qem-v1', clusterStrategy: 'dag-groups' as const };
function clusterSphere(page: { min: number[]; max: number[] }) {
  const c = [0, 1, 2].map((i) => (page.min[i] + page.max[i]) / 2);
  return [...c, Math.hypot(...[0, 1, 2].map((i) => page.max[i] - c[i])) || 1];
}
/** `leaves` replaced by `coarse`, plus clusters nothing replaces: the DAG THREE.LOD reads. */
export function dag(leaves: Cluster[], coarse: Cluster[], roots: Cluster[] = [], error = 1) {
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
