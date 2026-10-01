import test from 'node:test';
import assert from 'node:assert/strict';
import { buffer } from './index.ts';

test('numeric buffer factories retain typed storage, declared formats and vertex sizes', () => {
  for (const [make, Kind, type] of [
    [buffer.float32, Float32Array, 'Float32Array'],
    [buffer.float16, Float32Array, 'Float16Array'],
    [buffer.uint32, Uint32Array, 'Uint32Array'],
    [buffer.uint16, Uint16Array, 'Uint16Array'],
    [buffer.uint8, Uint8Array, 'Uint8Array'],
    [buffer.int32, Int32Array, 'Int32Array'],
    [buffer.int16, Int16Array, 'Int16Array'],
    [buffer.int8, Int8Array, 'Int8Array'],
  ] as const) {
    const source = new Kind([1, 2, 3, 4]);
    const attribute = make(source, 2);
    assert.equal(attribute.array, source);
    assert.equal(attribute.type, type);
    assert.equal(attribute.itemSize, 2);
    assert.equal(attribute.count, 2);
    assert.equal(attribute.normalized, false);
    const converted = make([4, 3, 2]);
    assert.ok(converted.array instanceof Kind);
    assert.deepEqual([...converted.array], [4, 3, 2]);
    assert.equal(converted.itemSize, 1);
  }
  const packed = new Float32Array([1, 2, 3, 4, 5, 6]);
  const interleaved = buffer.interleaved(packed, 3);
  assert.equal(interleaved.array, packed);
  assert.equal(interleaved.stride, 3);
  assert.equal(interleaved.count, 2);
});
