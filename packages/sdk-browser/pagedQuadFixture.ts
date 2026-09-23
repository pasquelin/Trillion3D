import * as THREE from 'three';
import { encodeGeometryPage } from '../page-codec/geometryPage.ts';
import { dagRoots } from './webgpuPagesTestDag.ts';
import { mockGpu } from '../../tests/kit/gpu/mockGpu.ts';
import { QUAD_MANIFEST, quadScene } from './pagesBackendScenes.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import type { BackendDiagnostic } from './backendTypes.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

const POSITIONS = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
/** The two triangles of the quad, as the corner lists a compiler would cluster them into. */
export const FIRST = new Uint32Array([0, 1, 2]),
  SECOND = new Uint32Array([0, 2, 3]);
/** Attributes a cluster's page carries beyond its positions, by glTF name. */
type Attributes = Record<string, { itemSize: number; array: Float32Array }>;
/** One cluster of the fixture: its corner list, what its page holds, and whether the cache wrote
 *  that page at all — a cluster without one keeps its index page and its float buffers. */
export type ClusterSpec = { corners: Uint32Array; attributes?: Attributes; paged?: boolean };

/** The quad clustered as `specs` says, each cluster carrying the quantized page the compiler would
 *  have written for it. */
export function pagedQuad(specs: readonly ClusterSpec[]) {
  const { geometry, material, mesh, source } = quadScene(
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  );
  const bytes = new Map<string, Uint8Array>(),
    encoded: ReturnType<typeof encodeGeometryPage>[] = [];
  const pages = dagRoots(
    specs.map((spec, id) => {
      const page = {
        id,
        url: String(id),
        count: spec.corners.length,
        min: [-1, -1, 0] as number[],
        max: [1, 1, 0] as number[],
        bytes: spec.corners.byteLength,
        sha256: 'x',
      };
      if (spec.paged === false) return page;
      const geo = encodeGeometryPage(
        spec.corners,
        { POSITION: { itemSize: 3, array: POSITIONS }, ...spec.attributes },
        -6,
      );
      encoded[id] = geo;
      bytes.set(`g${id}`, geo.data);
      return {
        ...page,
        geometry: {
          url: `g${id}`,
          sha256: 'g',
          bytes: geo.data.byteLength,
          vertexCount: geo.vertexCount,
          indexCount: geo.indexCount,
          flags: geo.flags,
          uncompressedBytes: geo.uncompressedBytes,
        },
      };
    }),
  );
  const metadata: ClusterManifest = {
    ...QUAD_MANIFEST,
    primitives: [
      {
        mesh: 0,
        primitive: 0,
        pass: 'exact-clusters',
        pages,
        structure: { version: 1, roots: specs.map((_, id) => id), groups: [] },
        quantization: { positionExponent: -6, uvExponent: -14, maxPositionError: 0.02 },
      },
    ],
  };
  return {
    geometry,
    material,
    source,
    metadata,
    encoded,
    bytes,
    indices: new Map(specs.map((spec, id) => [String(id), spec.corners])),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  };
}

export type PagedQuad = ReturnType<typeof pagedQuad>;

/** The WebGPU backend over one such fixture, on the mock device, with its page reader. */
export function pagedQuadBackend(
  fixture: PagedQuad,
  events: BackendDiagnostic[],
  readGeometryPage = async (url: string) => fixture.bytes.get(url)!,
) {
  const gpu = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: fixture.metadata.primitives[0].pages.length,
    viewport: [32, 32],
    readGeometryPage,
    onDiagnostic: (event: BackendDiagnostic) => events.push(event),
  } as never);
  return { gpu, backend };
}

/** Disposes a fixture and the backend mounted on it. */
export const disposePagedQuad = async (backend: { dispose(): unknown }, fixture: PagedQuad) => {
  await backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
};
