import { CLUSTERED_BLEND_FORMAT_VERSION } from '../../../packages/sdk-core/src/contracts/base.ts'
import { GEOMETRY_PAGE_FORMAT_VERSION } from '../../../packages/sdk-core/src/page/format.ts'
import type { ClusterManifest } from '../../../packages/sdk-core/src/contracts/geometry.ts'
import {
  geometryPageAddress,
  streamBundleAddress,
} from '../../../packages/sdk-core/src/page/contracts.ts'
import { previewFirstLevel } from '../../../packages/sdk-core/src/texture/previewLevels.ts'
import { previewLevels } from './manifestBinaryLevels.ts'

export const sha = (c: string) => c.repeat(64)
const url = (c: string) => `../../objects/${sha(c)}.bin`
/** The fixture's one geometry container. */
const FILE = { url: url('e'), sha256: sha('e'), bytes: 96 }
/** The sidecar's address and the geometry container its pages lie in. */
export const BINARY = { url: 'clusters.bin', geometryFiles: [FILE] }

/** The streaming bundle of digest `sha(c)`, `bytes` long at `offset` of the fixture's container,
 *  needing the bundles `dependencies` of its primitive. */
function bundle(c: string, offset: number, bytes: number, count: number, dependencies: number[]) {
  const range = { file: FILE.url, offset }
  return {
    url: streamBundleAddress(FILE.url, offset),
    range,
    sha256: sha(c),
    bytes,
    count,
    dependencies,
  }
}
const BUNDLES = [bundle('a', 0, 32, 1, []), bundle('b', 32, 48, 1, [0]), bundle('f', 80, 16, 1, [])]

/** A page of `stream`, `bytes` long at `offset` of that bundle (`BUNDLES[at]`), and the page
 *  fields that name it: proven by its bundle's digest. */
function placed(
  [stream, at]: [number, number],
  offset: number,
  bytes: number,
  facts: Record<string, number>,
) {
  const { url, range, sha256 } = BUNDLES[at]
  const geometry = {
    url: geometryPageAddress(range.file, range.offset + offset),
    bundle: { url, offset },
    sha256,
    bytes,
    ...(facts as {
      vertexCount: number
      indexCount: number
      flags: number
      uncompressedBytes: number
    }),
  }
  return { url: geometry.url, sha256, bytes, geometry, stream, streamOffset: offset }
}

/** Source dimensions of the fixture's single progressive-level entry. */
const PREVIEW_SIZE: [number, number] = [32, 16]

/** Every optional field in both of its shapes: a round trip that misses one would show here. */
export function manifest(): ClusterManifest {
  const dagPages = [
    {
      id: 0,
      ...placed([0, 0], 0, 32, {
        vertexCount: 8,
        indexCount: 12,
        flags: 15,
        uncompressedBytes: 128,
      }),
      count: 12,
      start: 0,
      min: [-1, -2, -3],
      max: [1, 2, 3],
      role: 'exact' as const,
      level: 0,
      lodError: 0,
      sphere: [0, 0, 0, 3.7416573867739413],
      parentError: 0.25,
      parentSphere: [0.5, 0, 0, 4],
      group: 0,
      source: null,
      cone: { axis: [-0.0621135613999339, 0.027174688463389093, 0.9976990737678042], angle: 1.75 },
    },
    {
      id: 1,
      ...placed([1, 1], 0, 48, { vertexCount: 8, indexCount: 12, flags: 1, uncompressedBytes: 96 }),
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
      cone: { axis: [0, 0, 1], angle: Math.PI },
    },
  ]
  // The sparse shape: a cluster band and its geometry in its bundle — no group, no role.
  const sparsePages = [
    {
      id: 0,
      ...placed([0, 2], 0, 16, { vertexCount: 4, indexCount: 6, flags: 1, uncompressedBytes: 48 }),
      count: 6,
      min: [0, 0, 0],
      max: [1, 1, 1],
      level: 0,
      lodError: 0,
      sphere: [0.5, 0.5, 0.5, 0.8660254037844386],
      parentError: null,
      parentSphere: null,
      cone: { axis: [1, 0, 0], angle: 0.5 },
    },
  ]
  // A copy: a test that alters the manifest leaves the shared bundles as they are.
  return structuredClone({
    formatVersion: CLUSTERED_BLEND_FORMAT_VERSION,
    status: 'ready',
    key: 'k',
    scope: 'full',
    errorModel: 'dag-group-qem-v4',
    geometryPages: { formatVersion: GEOMETRY_PAGE_FORMAT_VERSION, codec: 'quantized' as const },
    simplification: true,
    sourceTriangles: 8,
    selectedTriangles: 8,
    selectedNodes: 2,
    totalNodes: 2,
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
          dependencyBound: 1,
          maxDependencies: 1,
          pages: BUNDLES.slice(0, 2),
        },
      },
      {
        mesh: 1,
        primitive: 0,
        pass: 'exact-clusters',
        pages: sparsePages,
        culling: null,
        structure: null,
        streams: {
          version: 1,
          pinned: 1,
          bundleBytes: 131072,
          dependencyBound: 0,
          maxDependencies: 0,
          pages: BUNDLES.slice(2),
        },
      },
    ],
  } as ClusterManifest)
}
