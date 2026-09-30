// #1238: a world super-root page — raw world-space `f32` vertices and `u16` local indices — is not
// a `WGP3` page. Read at its world address from the cook's own fixture, it becomes a decoded page
// whose indices are widened to `u32` one-to-one, a position list in world space and no pose, and it
// is uploaded and drawn by the WebGL2 cluster path unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPage } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts';
import type { WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts';
import { WebglClusterGeometry } from '../webgl/cluster/geometry.ts';
import { submitRanges } from '../webgl/cluster/submit.ts';
import { worldRootsPageFixtureSource } from './worldRootsPage.fixture.ts';
import {
  worldRootsGeometry,
  worldRootsPageAddress,
  worldRootsPageSource,
} from './worldRootsPage.ts';

/** A WebGL2 context that records the buffer uploads and the draws, and no-ops the rest. */
function recordingGl() {
  const uploads: [string, number, number][] = [],
    draws: [number, number, number, number][] = [],
    call = () => {};
  const gl = new Proxy(
    {
      ARRAY_BUFFER: 34962,
      ELEMENT_ARRAY_BUFFER: 34963,
      FLOAT: 5126,
      UNSIGNED_INT: 5125,
      TRIANGLES: 4,
      createBuffer: () => ({}),
      createVertexArray: () => ({}),
      bufferData: (target: number, array: ArrayBufferView) =>
        void uploads.push(['data', target, array.byteLength]),
      bufferSubData: () => {},
      drawElements: (mode: number, count: number, type: number, offset: number) =>
        void draws.push([mode, count, type, offset]),
    },
    { get: (known, name: string) => (known as Record<string, unknown>)[name] ?? call },
  );
  return { gl: gl as unknown as WebGL2RenderingContext, uploads, draws };
}

test('a world-roots page read at its address is world-space with widened indices (#1238)', async () => {
  const source = worldRootsPageFixtureSource(),
    address = worldRootsPageAddress('world-roots.bin', 1, 0),
    page = await source.page(address);
  // Its own vertices, in world space, and its `u16` local triangles: the cook's bytes.
  assert.deepEqual([...page.positions], [1, 0, 0, 2, 0, 0, 1, 1, 0]);
  assert.ok(page.indices instanceof Uint16Array, 'the page holds 16-bit local indices');
  assert.deepEqual([...page.indices], [0, 1, 2]);
  const decoded = await source.decoded(address);
  assert.ok(decoded.indices instanceof Uint32Array, 'the engine reads 32-bit indices');
  assert.deepEqual([...decoded.indices], [0, 1, 2], 'widened one-to-one');
  assert.deepEqual([...decoded.attributes.position], [1, 0, 0, 2, 0, 0, 1, 1, 0]);
  assert.equal(decoded.vertexCount, 3);
});

test('its WebGL2 geometry keeps the world box and uploads a 32-bit triangle (#1238)', async () => {
  const page = await worldRootsPageFixtureSource().page(
      worldRootsPageAddress('world-roots.bin', 2, 0),
    ),
    geometry = worldRootsGeometry(page);
  assert.ok(geometry.index!.array instanceof Uint32Array, 'the draw reads UNSIGNED_INT');
  assert.deepEqual([...geometry.index!.array], [0, 1, 2]);
  assert.equal(geometry.attributes.position.count, 3);
  const box = geometry.boundingBox!;
  assert.deepEqual(
    [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z],
    [2, 0, 0, 3, 1, 0],
  );
  // The engine's own upload path: the widened index list and the world position list reach GL.
  const { gl, uploads, draws } = recordingGl(),
    cache = new WebglClusterGeometry(gl, {
      position: 0,
      normal: -1,
      uv: -1,
      uv1: -1,
      color: -1,
    });
  cache.beginFrame();
  cache.bind(geometry);
  assert.deepEqual(
    uploads.filter(([, target]) => target === gl.ELEMENT_ARRAY_BUFFER),
    [['data', gl.ELEMENT_ARRAY_BUFFER, 12]],
    'three 32-bit indices',
  );
  assert.deepEqual(
    uploads.filter(([, target]) => target === gl.ARRAY_BUFFER),
    [['data', gl.ARRAY_BUFFER, 36]],
    'three world-space vertices',
  );
  submitRanges(gl, null, Int32Array.of(0), Int32Array.of(3), 1);
  assert.deepEqual(draws, [[gl.TRIANGLES, 3, gl.UNSIGNED_INT, 0]], 'one triangle, 32-bit indexed');
});

test('a bundle of several pages resolves the one its offset names (#1238)', async () => {
  // The fixture gives one page a bundle; a bundle of two proves the offset → page mapping, not the
  // bundle count: the source picks the page whose `offset` the table lists, in binary order.
  const low = worldPage(0),
    high = worldPage(2),
    bin = new Uint8Array(low.byteLength + high.byteLength);
  bin.set(low, 0);
  bin.set(high, low.byteLength);
  const table = {
      bundles: [{ offset: 0, bytes: bin.byteLength, sha256: '0', count: 2, dependencies: [] }],
      pages: [
        { bundle: 0, offset: 0, level: 1, lodError: 1 },
        { bundle: 0, offset: low.byteLength, level: 0, lodError: 0 },
      ],
    } as unknown as WorldRoots,
    source = worldRootsPageSource(table, async (from, length) => bin.slice(from, from + length));
  const atLow = await source.page(worldRootsPageAddress('world-roots.bin', 0, 0)),
    atHigh = await source.page(worldRootsPageAddress('world-roots.bin', 0, low.byteLength));
  assert.deepEqual([...atLow.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual([...atHigh.positions], [2, 0, 0, 3, 0, 0, 2, 1, 0]);
});

test('one caller aborting leaves the shared bundle read to the others; no bundle, no page (#1238)', async () => {
  const source = worldRootsPageFixtureSource(),
    address = worldRootsPageAddress('world-roots.bin', 1, 0),
    aborted = AbortSignal.abort();
  const [cancelled, kept] = await Promise.allSettled([
    source.page(address, aborted),
    source.page(address),
  ]);
  assert.equal(cancelled.status, 'rejected', 'the aborted caller is refused');
  assert.equal(kept.status, 'fulfilled', 'the other caller of the same bundle gets its page');
  await assert.rejects(
    source.page(worldRootsPageAddress('world-roots.bin', 99, 0)),
    /WORLD_PAGE_MISSING/,
  );
});
