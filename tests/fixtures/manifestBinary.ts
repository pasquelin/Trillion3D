import { CLUSTERED_BLEND_FORMAT_VERSION } from '../../packages/sdk-core/src/contracts/base.ts';
import type { ClusterManifest } from '../../packages/sdk-core/src/contracts/index.ts';
import {
  levelBlockBytes,
  previewFirstLevel,
  previewGeometry,
} from '../../packages/sdk-core/src/texture/previewLevels.ts';

export const TEMPLATES = {
  url: 'clusters.bin',
  pageUrl: '../../objects/{sha}.bin',
  geometryUrl: '../../objects/{sha}.bin',
  bundleUrl: '../../objects/{sha}.bin',
};
export const sha = (c: string) => c.repeat(64);
const url = (c: string) => `../../objects/${sha(c)}.bin`;

/** Source dimensions of the fixture's single progressive-level entry. */
const PREVIEW_SIZE: [number, number] = [32, 16];

/** The tail of a `width`×`height` source, each level `bytesOf` its dimensions, every byte
 *  deterministic and level-distinct so a round trip that mixed up two levels would show here. */
function previewTail(
  width: number,
  height: number,
  seed: number,
  bytesOf: (w: number, h: number) => number,
) {
  return previewGeometry(width, height).sizes.map(
    ([w, h], index) =>
      new Uint8Array(bytesOf(w, h)).map(
        (_byte, i) => (i + index + seed) % 256,
      ) as Uint8Array<ArrayBuffer>,
  );
}
/** One progressive level pyramid: the lossless RGBA8 tail, and the same tail in each block
 *  family's blocks — RGBA in the BC family, two channels in ASTC — as the sidecar carries them. */
export function previewLevels(width: number, height: number, seed: number) {
  return {
    levels: previewTail(width, height, seed, (w, h) => w * h * 4),
    layouts: { bc7: 'rgba', astc: 'two-channel' } as const,
    blocks: {
      bc7: previewTail(width, height, seed + 1, levelBlockBytes),
      astc: previewTail(width, height, seed + 2, levelBlockBytes),
    },
  };
}

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
    schema: CLUSTERED_BLEND_FORMAT_VERSION,
    formatVersion: CLUSTERED_BLEND_FORMAT_VERSION,
    status: 'ready',
    key: 'k',
    scope: 'full',
    errorModel: 'dag-group-qem-v2',
    geometryPages: { formatVersion: 3 as const, codec: 'quantized' as const },
    simplification: true,
    sourceTriangles: 8,
    selectedTriangles: 8,
    selectedNodes: [0, 1],
    totalNodes: 2,
    autonomousScene: null,
    texturePreviews: [
      {
        texture: 0,
        image: 0,
        width: PREVIEW_SIZE[0],
        height: PREVIEW_SIZE[1],
        sourceKind: 0,
        sourceBufferView: -1,
        atlas: 0,
        bakedLevels: 0,
        sha256: sha('9'),
        firstLevel: previewFirstLevel(...PREVIEW_SIZE),
        ...previewLevels(...PREVIEW_SIZE, 0),
      },
    ],
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
          maxDependencies: 1,
          pages: [
            { url: url('e'), sha256: sha('e'), bytes: 96, count: 2, dependencies: [] },
            { url: url('f'), sha256: sha('f'), bytes: 48, count: 1, dependencies: [0] },
          ],
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
