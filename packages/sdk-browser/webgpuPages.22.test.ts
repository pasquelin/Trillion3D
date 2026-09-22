import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.ts';
import { dagRoots } from './webgpuPagesTestDag.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { QUAD_MANIFEST, frontCamera, quadIndices, quadScene } from './pagesBackendScenes.ts';
import type { BackendDiagnostic } from './backendTypes.ts';
import type { ClusterManifest } from '../sdk-core/index.ts';

const POSITIONS = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
const CORNERS = [new Uint32Array([0, 1, 2]), new Uint32Array([0, 2, 3])];

/** The two clusters of the quad, each with the quantized page the compiler would have written
 *  for it — the second only when `both`, so a cluster without a page can be told apart. */
function pagedQuad(both: boolean) {
  const { geometry, material, mesh, source } = quadScene(
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  );
  const encoded = CORNERS.map((corners) =>
    encodeGeometryPage(corners, { POSITION: { itemSize: 3, array: POSITIONS } }, -6),
  );
  const bytes = new Map<string, Uint8Array>();
  const pages = dagRoots(
    [0, 1].map((id) => {
      const page = {
        id,
        url: String(id),
        count: 3,
        min: [-1, -1, 0] as number[],
        max: [1, 1, 0] as number[],
        bytes: 12,
        sha256: 'x',
      };
      if (id > 0 && !both) return page;
      const geo = encoded[id];
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
        structure: { version: 1, roots: [0, 1], groups: [] },
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
    indices: quadIndices(),
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
  };
}

function backendOver(both: boolean, events: BackendDiagnostic[]) {
  const fixture = pagedQuad(both);
  const gpu = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
    readGeometryPage: async (url: string) => fixture.bytes.get(url)!,
    onDiagnostic: (event: BackendDiagnostic) => events.push(event),
  } as never);
  return { fixture, gpu, backend };
}

const cleanUp = async (
  backend: { dispose(): unknown },
  fixture: { geometry: THREE.BufferGeometry; material: THREE.Material },
) => {
  await backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
};

// The pool holds page WORDS, never a decode of them: what lands in a slot is, byte for byte, the
// `WGP3` object the compiler wrote, and it lands at the word offset the cache gave that cluster.
test('an admitted cluster puts its quantized page bytes at its own pool slot', async () => {
  installGpuGlobals();
  const events: BackendDiagnostic[] = [];
  const { fixture, gpu, backend } = backendOver(true, events);
  try {
    await backend.prepare();
    backend.render(frontCamera());
    await backend.flush?.();
    const pool = gpu.buffers.find((buffer) => buffer.label === 'WG geometry page cache');
    assert.ok(pool, 'no geometry page pool');
    const declared = events.find((event) => event.phase === 'geometry-pages');
    const slotBytes = Number(declared?.context.slotBytes);
    assert.ok(slotBytes >= fixture.encoded[0].data.byteLength);
    // Which cluster took which slot is the cache's business; that both pages are in the pool
    // whole, each at a slot of its own, is the engine's.
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
    const held = fixture.encoded.map((page, slot) =>
      hex(pool.data.subarray(slot * slotBytes, slot * slotBytes + page.data.byteLength)),
    );
    assert.deepEqual(held.sort(), fixture.encoded.map((page) => hex(page.data)).sort());
  } finally {
    await cleanUp(backend, fixture);
  }
});

// A cluster the cache left without a geometry page is not silently drawn from one: it keeps the
// source float buffers, and the engine says how many clusters are on each side.
test('clusters without a geometry page are counted, not assumed', async () => {
  installGpuGlobals();
  const events: BackendDiagnostic[] = [];
  const { fixture, backend } = backendOver(false, events);
  try {
    await backend.prepare();
    const split = events.find((event) => event.phase === 'geometry-pages');
    assert.ok(split, 'the engine published no geometry-page count');
    assert.equal(split.context.fromGeometryPage, 1);
    assert.equal(split.context.fromSourceGeometry, 1);
    assert.equal(split.context.clusters, 2);
  } finally {
    await cleanUp(backend, fixture);
  }
});
