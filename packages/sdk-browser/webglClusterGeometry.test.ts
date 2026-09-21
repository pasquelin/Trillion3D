import test from 'node:test';
import assert from 'node:assert/strict';
import { PrimitiveIndex } from './clusterBatchPrimitive.ts';
import { WebglClusterGeometry } from './webglClusterGeometry.ts';
import { attributes } from './clusterBatchesFixture.ts';

type Upload = { kind: 'data' | 'sub'; bytes: number; offset: number };

/** The buffer calls the cache makes on the element array, everything else accepted silently. */
function stubContext() {
  const uploads: Upload[] = [];
  const ELEMENT_ARRAY_BUFFER = 34963;
  let bound = 0;
  const gl = {
    ELEMENT_ARRAY_BUFFER,
    ARRAY_BUFFER: 34962,
    DYNAMIC_DRAW: 35048,
    STATIC_DRAW: 35044,
    FLOAT: 5126,
    UNSIGNED_INT: 5125,
    createBuffer: () => ({}),
    createVertexArray: () => ({}),
    bindVertexArray() {},
    bindBuffer(target: number) {
      bound = target;
    },
    bufferData(_target: number, array: ArrayBufferView) {
      if (bound === ELEMENT_ARRAY_BUFFER)
        uploads.push({ kind: 'data', bytes: array.byteLength, offset: 0 });
    },
    bufferSubData(
      _target: number,
      offset: number,
      array: ArrayBufferView & { BYTES_PER_ELEMENT: number },
      _start = 0,
      count = array.byteLength / array.BYTES_PER_ELEMENT,
    ) {
      if (bound === ELEMENT_ARRAY_BUFFER)
        uploads.push({ kind: 'sub', bytes: count * array.BYTES_PER_ELEMENT, offset });
    },
    enableVertexAttribArray() {},
    disableVertexAttribArray() {},
    vertexAttribPointer() {},
    vertexAttrib2f() {},
    vertexAttrib4f() {},
  };
  return { gl: gl as unknown as WebGL2RenderingContext, uploads };
}

const LOCATIONS = { position: 0, normal: -1, uv: -1, uv1: -1, color: -1 };

test('the resident index uploads the ranges written since its last bind, merged when contiguous', () => {
  const primitive = new PrimitiveIndex(
    attributes(12),
    Int32Array.of(0, 1, 2),
    Int32Array.of(3, 3, 6),
  );
  const { gl, uploads } = stubContext();
  const cache = new WebglClusterGeometry(gl, LOCATIONS);
  cache.bind(primitive.geometry);
  assert.deepEqual(uploads, [{ kind: 'data', bytes: 12 * 4, offset: 0 }], 'first bind: whole');
  cache.bind(primitive.geometry);
  assert.equal(uploads.length, 1, 'nothing written, nothing uploaded');

  const version = primitive.version;
  primitive.reserve(0, Uint32Array.of(1, 2, 3));
  primitive.reserve(1, Uint32Array.of(4, 5, 6));
  assert.ok(primitive.version > version, 'every write moves the version');
  assert.deepEqual(primitive.updateRanges, [{ start: 0, count: 6 }], 'contiguous pages merge');
  cache.bind(primitive.geometry);
  assert.deepEqual(uploads.at(-1), { kind: 'sub', bytes: 6 * 4, offset: 0 }, 'the ranges alone');
  assert.deepEqual(primitive.updateRanges, [], 'sent, then cleared');

  primitive.free(0);
  primitive.reserve(2, Uint32Array.of(7, 8, 9, 10, 11, 12));
  cache.bind(primitive.geometry);
  assert.deepEqual(uploads.at(-1), { kind: 'sub', bytes: 6 * 4, offset: 6 * 4 }, 'at its offset');
  assert.equal(uploads.length, 3);
});

test('a growth of the resident index drops the pending ranges: the next bind uploads it whole', () => {
  const primitive = new PrimitiveIndex(attributes(6), Int32Array.of(0, 1), Int32Array.of(3, 3));
  const { gl, uploads } = stubContext();
  const cache = new WebglClusterGeometry(gl, LOCATIONS);
  cache.bind(primitive.geometry);
  primitive.reserve(0, Uint32Array.of(1, 2, 3));
  // Larger than the manifest announced: the buffer grows, the range written before it leaves
  // with the whole buffer.
  primitive.reserve(1, Uint32Array.of(4, 5, 6, 7, 8, 9));
  assert.equal(primitive.count, 12, 'grown by the page that did not fit');
  assert.deepEqual(primitive.updateRanges, [{ start: 3, count: 6 }], 'only the range after');
  cache.bind(primitive.geometry);
  assert.deepEqual(uploads.at(-1), { kind: 'data', bytes: 12 * 4, offset: 0 });
  assert.deepEqual(primitive.updateRanges, []);
  assert.deepEqual([...primitive.array], [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0]);
});
