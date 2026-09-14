import type { ClusterManifest } from '../../packages/sdk-core/contracts.ts';

export const TEMPLATES = {
  url: 'clusters.bin',
  pageUrl: '../../objects/{sha}.bin',
  geometryUrl: '../../objects/{sha}.bin',
  bundleUrl: '../../objects/{sha}.bin',
};
export const sha = (c: string) => c.repeat(64);
const url = (c: string) => `../../objects/${sha(c)}.bin`;

/** Every optional field in both of its shapes: a round trip that misses one would show here. */
export function manifest(): ClusterManifest {
  const dagPages = [
    {
      id: 0,
      url: url('a'),
      sha256: sha('a'),
      bytes: 48,
      count: 12,
      start: 0,
      min: [-1, -2, -3],
      max: [1, 2, 3],
      role: 'exact' as const,
      geometry: {
        url: url('b'),
        sha256: sha('b'),
        bytes: 32,
        formatVersion: 2 as const,
        codec: 'meshopt' as const,
        vertexCount: 8,
        indexCount: 12,
        flags: 15,
        uncompressedBytes: 128,
      },
      level: 0,
      lodError: 0,
      sphere: [0, 0, 0, 3.7416573867739413],
      parentError: 0.25,
      parentSphere: [0.5, 0, 0, 4],
      group: 0,
      source: null,
      stream: 0,
      streamOffset: 0,
    },
    {
      id: 1,
      url: url('c'),
      sha256: sha('c'),
      bytes: 48,
      count: 12,
      start: 12,
      min: [0, 0, 0],
      max: [2, 2, 2],
      role: 'coarse' as const,
      level: 1,
      lodError: 0.25,
      sphere: [1, 1, 1, 1.7320508075688772],
      parentError: null,
      parentSphere: null,
      group: null,
      source: 0,
      stream: 0,
      streamOffset: 48,
    },
  ];
  // The sparse shape: a cluster band and nothing else — no group, no bundle, no packed geometry.
  const sparsePages = [
    {
      id: 0,
      url: url('d'),
      sha256: sha('d'),
      bytes: 24,
      count: 6,
      min: [0, 0, 0],
      max: [1, 1, 1],
      level: 0,
      lodError: 0,
      sphere: [0.5, 0.5, 0.5, 0.8660254037844386],
      parentError: null,
      parentSphere: null,
    },
  ];
  return {
    schema: 2,
    formatVersion: 2,
    status: 'ready',
    key: 'k',
    scope: 'full',
    errorModel: 'dag-group-qem-v1',
    simplification: true,
    sourceTriangles: 8,
    selectedTriangles: 8,
    selectedNodes: [0, 1],
    totalNodes: 2,
    autonomousScene: null,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        clusterStrategy: 'dag-groups',
        pages: dagPages,
        culling: {
          stride: 15,
          count: 1,
          nodes: [-1, -2, -3, 1, 2, 3, 0, 0, 0, 3.7416573867739413, -1, 0, 0, 0, 2],
        },
        structure: {
          version: 1,
          roots: [1],
          groups: [{ level: 1, error: 0.25, sphere: [0.5, 0, 0, 4], children: [0], outputs: [1] }],
        },
        streams: {
          version: 1,
          pinned: 1,
          bundleBytes: 131072,
          pages: [{ url: url('e'), sha256: sha('e'), bytes: 96, count: 2 }],
        },
        topology: {
          triangles: 8,
          edges: { boundary: 4, manifold: 8, nonManifold: 0 },
          vertices: { interior: 1, boundary: 4, locked: 0, unused: 0 },
          manifold: true,
        },
      },
      {
        mesh: 1,
        primitive: 0,
        pass: 'exact-clusters',
        pages: sparsePages,
        culling: null,
        structure: null,
        streams: null,
      },
    ],
  } as ClusterManifest;
}
