// #840: an arena grown by a copy on the GPU left pages empty on ANGLE's Metal backend once a later
// write reached a buffer still in use. It grows by sending every page again from its own arrays;
// through placements, releases and growths, every page reads its own vertices and indices.
import test from 'node:test'
import assert from 'node:assert/strict'
import { WebglPageArena } from './pageArena.ts'

type Buffer = { bytes?: Uint8Array }

/** A context holding its buffers' bytes; a copy between buffers is refused. */
function context() {
  const bound: Record<string, Buffer | null> = {}
  let array = { element: null as Buffer | null }
  const at = (target: string) => (target === 'E' ? array.element : bound[target])!
  const gl = {
    ARRAY_BUFFER: 'A',
    ELEMENT_ARRAY_BUFFER: 'E',
    STATIC_DRAW: 0,
    FLOAT: 0,
    createVertexArray: () => ({ element: null }),
    createBuffer: (): Buffer => ({}),
    bindVertexArray: (next: typeof array) => (array = next),
    bindBuffer: (target: string, buffer: Buffer) =>
      target === 'E' ? (array.element = buffer) : (bound[target] = buffer),
    bufferData: (target: string, data: ArrayBufferView) =>
      (at(target).bytes = new Uint8Array(data.buffer.slice(0))),
    bufferSubData: (
      target: string,
      offset: number,
      source: Float32Array,
      from: number,
      n: number,
    ) =>
      at(target).bytes!.set(
        new Uint8Array(source.buffer, source.byteOffset + from * 4, n * 4),
        offset,
      ),
    copyBufferSubData: () => assert.fail('no copy on the GPU'),
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    deleteBuffer() {},
    deleteVertexArray() {},
  }
  const bytes = (buffer: Buffer | null) => buffer!.bytes!.buffer
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    vertices: () => new Float32Array(bytes(bound.A)),
    indices: () => new Uint32Array(bytes(array.element)),
  }
}

test('through growths and releases, every page reads its own vertices and indices', () => {
  const { gl, vertices, indices: held } = context()
  const arena = new WebglPageArena(gl, [{ name: 'position', location: 0, size: 1 }], () => {})
  const pages = new Map<number, { vertex: number; first: number; count: number; size: number }>()
  for (let id = 0; id < 400; id++) {
    const size = 3 + (id % 17),
      count = 3 * (1 + ((id * 7) % 23))
    if (id % 3 === 2) {
      const [gone, page] = pages.entries().next().value!
      arena.retire(page.first)
      arena.release(page.vertex, page.size, page.first, page.count)
      pages.delete(gone)
    }
    const indices = new Uint32Array(count).map((_, i) => i % size)
    const placed = arena.place([new Float32Array(size).fill(id)], size, indices)
    pages.set(id, { ...placed, count, size })
  }
  const [values, index] = [vertices(), held()]
  assert.ok(pages.size > 200)
  for (const [id, { vertex, first, count, size }] of pages) {
    for (let v = 0; v < size; v++) assert.equal(values[vertex + v], id, `page ${id}'s vertices`)
    for (let i = 0; i < count; i++)
      assert.equal(index[first + i], vertex + (i % size), `page ${id}'s indices`)
  }
})
