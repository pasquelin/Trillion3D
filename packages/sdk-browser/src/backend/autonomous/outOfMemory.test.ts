// #840: out of memory on WebGL2 is absorbed. An allocation the context refuses marks it once the
// frame after reads it (`../../webgl/core/allocation.ts`); the next image halves the geometry pool
// (`pool.ts`), and the residency pays it one DAG level per image, as a budget cut mid-session (#839).
import test from 'node:test';
import assert from 'node:assert/strict';
import { upload } from '../../webgl/cluster/buffers.ts';
import { coverFault } from '../../page/cut/cutRule.fixture.ts';
import { levels, strip, wholeStrip } from './poolStrip.fixture.ts';
import type { GpuBuffer } from '../../cluster/batchMesh.ts';

const OUT_OF_MEMORY = 0x0505;

/** A context whose next allocation is refused as `OUT_OF_MEMORY`, then every one granted. */
function refusingContext() {
  let refuse = false;
  const gl = {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    NO_ERROR: 0,
    OUT_OF_MEMORY,
    CONTEXT_LOST_WEBGL: 0x9242,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
    fenceSync: () => ({}),
    getSyncParameter: () => 0x9119,
    deleteSync() {},
    createBuffer: () => ({}),
    bindBuffer() {},
    bufferData() {},
    getError: () => (refuse ? ((refuse = false), OUT_OF_MEMORY) : 0),
  } as unknown as WebGL2RenderingContext;
  return { gl, refuseNext: () => (refuse = true) };
}

/** A page's geometry as the cluster program uploads it. */
const geometry = () =>
  ({
    array: new Float32Array(9),
    version: 1,
    updateRanges: [],
    clearUpdateRanges() {},
  }) as unknown as GpuBuffer;

test('a refused allocation draws the next images one level coarser, never a hole', () => {
  const { gl, refuseNext } = refusingContext();
  const { image, dag, pages, drawnIds, pool, state, diagnostics } = strip(70, wholeStrip(), gl);
  for (let i = 0; i < 24; i++) image(0.25);
  const held = pool.held.allocatedBytes,
    fine = state.allocationBytes;
  let before = levels(dag, drawnIds()),
    drawn = drawnIds();
  refuseNext();
  const attribute = geometry(),
    buffer = upload(gl, gl.ARRAY_BUFFER, attribute);
  let coarser = 0;
  for (let i = 0; i < 24; i++) {
    assert.ok(
      drawn.every((id) => pages[id].array),
      `image ${i}: a drawn page left`,
    );
    image(0.25, 3);
    drawn = drawnIds();
    assert.equal(coverFault(dag, drawn), -1, `image ${i}: a leaf not covered exactly once`);
    const now = levels(dag, drawn);
    for (let u = 0; u < dag.leaves; u++) {
      assert.ok(now[u] <= before[u] + 1, `image ${i}, leaf ${u}: ${before[u]} → ${now[u]}`);
      if (now[u] > before[u]) coarser++;
    }
    before = now;
  }
  assert.equal(buffer.bytes, 0, 'the refused buffer, once read, is sized again');
  assert.equal(pool.held.allocatedBytes, Math.floor(held / 2 / 100) * 100, 'half the pool');
  assert.ok(fine > pool.held.allocatedBytes, `the fine cut (${fine}) no longer fits`);
  assert.ok(coarser > 0, 'the image drew coarser');
  assert.ok(state.allocationBytes <= pool.held.allocatedBytes, 'the pool converged to its half');
  const refused = diagnostics.filter(({ phase }) => phase === 'gpu-out-of-memory');
  assert.equal(refused.length, 1, 'published once');
  assert.equal(refused[0].context?.grantedBytes, pool.held.allocatedBytes);
  assert.equal(
    upload(gl, gl.ARRAY_BUFFER, attribute, buffer).bytes,
    attribute.array.byteLength,
    'the buffer is sized again once memory is granted',
  );
});
