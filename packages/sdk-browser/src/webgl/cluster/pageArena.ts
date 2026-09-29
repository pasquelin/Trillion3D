import { IndexRangeAllocator } from '../../cluster/batchRange.ts';
import { allocated } from '../core/allocation.ts';

/** One attribute of an arena's layout: the program's location for it, its floats per vertex. */
export type ArenaAttribute = { name: string; location: number; size: number };

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const INDEX_BYTES = Uint32Array.BYTES_PER_ELEMENT;

/**
 * ONE VERTEX LAYOUT'S SHARED BUFFERS (#840): the vertices of every page drawn with that layout, one
 * buffer per attribute, and their indices, rebased on the page's first vertex, in one index buffer
 * — so that the pages of a run, one surface at one placement, draw in one submission of their
 * index ranges (`runs.ts`). Ranges come from the engine's range allocator (`IndexRangeAllocator`),
 * a released page's merged back with its neighbours. When no free range fits, the buffers grow to
 * twice their size at least, their bytes copied on the GPU (`copyBufferSubData`): the index ranges
 * placed keep their offsets. A growth is an allocation of the geometry pool: a refusal, once read
 * (`../core/allocation.ts`), gives the arena up (`lost`) and its pages are placed again in a new
 * one, the pool a level coarser.
 */
export class WebglPageArena {
  readonly vao: WebGLVertexArrayObject;
  readonly vertices = new IndexRangeAllocator(0);
  readonly indices = new IndexRangeAllocator(0);
  private buffers: WebGLBuffer[];
  private index: WebGLBuffer;
  private gl: WebGL2RenderingContext;
  readonly layout: readonly ArenaAttribute[];
  /** Runs once a growth is read refused. */
  private lost: () => void;
  constructor(gl: WebGL2RenderingContext, layout: readonly ArenaAttribute[], lost: () => void) {
    this.gl = gl;
    this.layout = layout;
    this.lost = lost;
    this.vao = gl.createVertexArray()!;
    this.buffers = layout.map(() => gl.createBuffer()!);
    this.index = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index);
    layout.forEach((attribute, i) => this.point(attribute, this.buffers[i]));
  }
  private point(attribute: ArenaAttribute, buffer: WebGLBuffer) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(attribute.location);
    gl.vertexAttribPointer(attribute.location, attribute.size, gl.FLOAT, false, 0, 0);
  }
  /** Places a page: its `vertices` in `attributes` — layout order, `size` floats a vertex — and
   *  its `indices`; returns its first vertex and its first index. */
  place(attributes: readonly ArrayBufferView[], vertices: number, indices: Uint32Array) {
    const vertex = this.reserve(this.vertices, vertices, (capacity) => this.growVertices(capacity)),
      first = this.reserve(this.indices, indices.length, (capacity) => this.growIndices(capacity));
    const gl = this.gl;
    this.layout.forEach((attribute, i) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]);
      const offset = vertex * attribute.size * FLOAT_BYTES;
      gl.bufferSubData(gl.ARRAY_BUFFER, offset, attributes[i], 0, vertices * attribute.size);
    });
    const rebased = this.rebased(indices, vertex);
    gl.bindVertexArray(this.vao);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, first * INDEX_BYTES, rebased, 0, indices.length);
    return { vertex, first };
  }
  /** Gives a page's ranges back. */
  release(vertex: number, vertices: number, first: number, indices: number) {
    this.vertices.release(vertex, vertices);
    this.indices.release(first, indices);
  }
  private scratch = new Uint32Array(0);
  private rebased(indices: Uint32Array, vertex: number) {
    if (this.scratch.length < indices.length) this.scratch = new Uint32Array(indices.length * 2);
    const out = this.scratch;
    for (let i = 0; i < indices.length; i++) out[i] = indices[i] + vertex;
    return out;
  }
  private reserve(ranges: IndexRangeAllocator, length: number, grow: (capacity: number) => void) {
    const at = ranges.allocate(length);
    if (at >= 0) return at;
    const capacity = Math.max(ranges.capacity * 2, ranges.capacity + length);
    grow(capacity);
    ranges.grow(capacity - ranges.capacity);
    return ranges.allocate(length);
  }
  private growVertices(capacity: number) {
    const gl = this.gl,
      held = this.vertices.capacity;
    gl.bindVertexArray(this.vao);
    this.layout.forEach((attribute, i) => {
      const bytes = attribute.size * FLOAT_BYTES;
      this.buffers[i] = this.grown(
        gl.ARRAY_BUFFER,
        this.buffers[i],
        held * bytes,
        capacity * bytes,
      );
      this.point(attribute, this.buffers[i]);
    });
  }
  private growIndices(capacity: number) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    const held = this.indices.capacity * INDEX_BYTES;
    this.index = this.grown(gl.ELEMENT_ARRAY_BUFFER, this.index, held, capacity * INDEX_BYTES);
  }
  /** A buffer of `bytes` bound on `target` — the arena's array bound for its indices —, holding
   *  the `held` bytes of `buffer`, which is deleted. */
  private grown(target: number, buffer: WebGLBuffer, held: number, bytes: number) {
    const gl = this.gl,
      next = gl.createBuffer()!;
    gl.bindBuffer(target, next);
    gl.bufferData(target, bytes, gl.STATIC_DRAW);
    allocated(gl, 'geometry', this.lost);
    if (held) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, buffer);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, next);
      gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, held);
    }
    gl.deleteBuffer(buffer);
    return next;
  }
  dispose() {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    gl.deleteBuffer(this.index);
  }
}
