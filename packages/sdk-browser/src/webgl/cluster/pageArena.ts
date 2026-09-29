import { IndexRangeAllocator } from '../../cluster/batchRange.ts';
import { allocated } from '../core/allocation.ts';

/** One attribute of an arena's layout: the program's location for it, its floats per vertex. */
export type ArenaAttribute = { name: string; location: number; size: number };

/** A page the arena holds: its own arrays, never copied, and where they sit. */
type Placed = {
  attributes: readonly ArrayBufferView[];
  indices: Uint32Array;
  vertex: number;
  vertices: number;
};

const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;
const INDEX_BYTES = Uint32Array.BYTES_PER_ELEMENT;

/**
 * ONE VERTEX LAYOUT'S SHARED BUFFERS (#840): the vertices of every page drawn with that layout, one
 * buffer per attribute, and their indices, rebased on the page's first vertex, in one index buffer
 * — so that the pages of a run, one surface at one placement, draw in one submission of their
 * index ranges (`runs.ts`). Ranges come from the engine's range allocator (`IndexRangeAllocator`),
 * a released page's merged back with its neighbours. When no free range fits, the buffers are made
 * again at twice their size at least and every page is sent again from its own arrays, which the
 * arena holds, never copies: a copy on the GPU (`copyBufferSubData`) left pages empty on ANGLE's
 * Metal backend once a later write reached a buffer still in use (sponza `rue`, one capture in
 * three). A growth is an allocation of the geometry pool: a refusal, once read
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
  /** The pages placed, by their first index. */
  private placed = new Map<number, Placed>();
  private scratch = new Uint32Array(0);
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
    const vertex = this.reserve(this.vertices, vertices, () => this.growVertices()),
      first = this.reserve(this.indices, indices.length, () => this.growIndices());
    const page: Placed = { attributes, indices, vertex, vertices };
    this.placed.set(first, page);
    this.sendVertices(page);
    this.gl.bindVertexArray(this.vao);
    this.sendIndices(page, first);
    return { vertex, first };
  }
  /** A page no longer drawn: not sent again at a growth, its ranges given back later
   *  (`release`). */
  retire(first: number) {
    this.placed.delete(first);
  }
  /** Gives a retired page's ranges back. */
  release(vertex: number, vertices: number, first: number, indices: number) {
    this.vertices.release(vertex, vertices);
    this.indices.release(first, indices);
  }
  private sendVertices({ attributes, vertex, vertices }: Placed) {
    const gl = this.gl;
    this.layout.forEach((attribute, i) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]);
      const offset = vertex * attribute.size * FLOAT_BYTES;
      gl.bufferSubData(gl.ARRAY_BUFFER, offset, attributes[i], 0, vertices * attribute.size);
    });
  }
  /** Sends a page's indices, rebased, into the index buffer the arena's array binds. */
  private sendIndices({ indices, vertex }: Placed, first: number) {
    if (this.scratch.length < indices.length) this.scratch = new Uint32Array(indices.length * 2);
    const rebased = this.scratch,
      gl = this.gl;
    for (let i = 0; i < indices.length; i++) rebased[i] = indices[i] + vertex;
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, first * INDEX_BYTES, rebased, 0, indices.length);
  }
  /** A free range of `length`; the allocator and its buffers grown first when none fits. */
  private reserve(ranges: IndexRangeAllocator, length: number, grown: () => void) {
    const at = ranges.allocate(length);
    if (at >= 0) return at;
    ranges.grow(Math.max(ranges.capacity, length));
    grown();
    return ranges.allocate(length);
  }
  /** Vertex buffers of the allocator's capacity, every page sent again. */
  private growVertices() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    this.layout.forEach((attribute, i) => {
      gl.deleteBuffer(this.buffers[i]);
      this.buffers[i] = this.made(gl.ARRAY_BUFFER, this.vertices.capacity * attribute.size);
      this.point(attribute, this.buffers[i]);
    });
    for (const page of this.placed.values()) this.sendVertices(page);
  }
  /** An index buffer of the allocator's capacity, every page sent again. */
  private growIndices() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.deleteBuffer(this.index);
    this.index = this.made(gl.ELEMENT_ARRAY_BUFFER, this.indices.capacity);
    for (const [first, page] of this.placed) this.sendIndices(page, first);
  }
  /** A buffer of `words` four-byte elements, bound on `target` — for indices, in the arena's
   *  array. */
  private made(target: number, words: number) {
    const gl = this.gl,
      buffer = gl.createBuffer()!;
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, words * FLOAT_BYTES, gl.STATIC_DRAW);
    allocated(gl, 'geometry', this.lost);
    return buffer;
  }
  dispose() {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    gl.deleteBuffer(this.index);
    this.placed.clear();
  }
}
