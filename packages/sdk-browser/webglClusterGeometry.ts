import type { GpuBuffer, VertexAttribute, WholeMesh } from './clusterBatchMesh.ts';

/** What the cache binds: a batch record's geometry, or that of a host mesh drawn whole. */
type Geometry = WholeMesh['geometry'];

type CachedAttribute = {
  buffer: WebGLBuffer;
  source: GpuBuffer;
  version: number;
  bytes: number;
};
type CachedGeometry = {
  vao: WebGLVertexArrayObject;
  index?: CachedAttribute;
  attributes: Map<string, CachedAttribute>;
};

const glType = (gl: WebGL2RenderingContext, array: ArrayBufferView) => {
  if (array instanceof Float32Array) return gl.FLOAT;
  if (array instanceof Uint32Array) return gl.UNSIGNED_INT;
  if (array instanceof Int32Array) return gl.INT;
  if (array instanceof Uint16Array) return gl.UNSIGNED_SHORT;
  if (array instanceof Int16Array) return gl.SHORT;
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return gl.UNSIGNED_BYTE;
  if (array instanceof Int8Array) return gl.BYTE;
  throw new Error(`Unsupported cluster attribute ${array.constructor.name}`);
};

const upload = (
  gl: WebGL2RenderingContext,
  target: number,
  attribute: GpuBuffer,
  known?: CachedAttribute,
) => {
  const current = known ?? { buffer: gl.createBuffer()!, source: attribute, version: -1, bytes: 0 };
  if (current.source !== attribute || current.version !== attribute.version) {
    gl.bindBuffer(target, current.buffer);
    if (current.bytes !== attribute.array.byteLength)
      gl.bufferData(
        target,
        attribute.array,
        target === gl.ELEMENT_ARRAY_BUFFER ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
      );
    else if (attribute.updateRanges.length) {
      const bytes = attribute.array.BYTES_PER_ELEMENT;
      for (const range of attribute.updateRanges)
        gl.bufferSubData(target, range.start * bytes, attribute.array, range.start, range.count);
    } else gl.bufferSubData(target, 0, attribute.array);
    current.bytes = attribute.array.byteLength;
    current.source = attribute;
    current.version = attribute.version;
    attribute.clearUpdateRanges();
  }
  return current;
};

export class WebglClusterGeometry {
  private cache = new Map<Geometry, CachedGeometry>();
  private gl: WebGL2RenderingContext;
  private locations: Record<string, number>;
  constructor(gl: WebGL2RenderingContext, locations: Record<string, number>) {
    this.gl = gl;
    this.locations = locations;
  }
  bind(geometry: Geometry) {
    const gl = this.gl;
    let cached = this.cache.get(geometry);
    if (!cached) {
      const index = geometry.index;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      cached = {
        vao,
        index: index ? upload(gl, gl.ELEMENT_ARRAY_BUFFER, index) : undefined,
        attributes: new Map(),
      };
      if (cached.index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cached.index.buffer);
      this.cache.set(geometry, cached);
    }
    gl.bindVertexArray(cached.vao);
    if (geometry.index) {
      cached.index = upload(gl, gl.ELEMENT_ARRAY_BUFFER, geometry.index, cached.index);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cached.index.buffer);
    }
    for (const name of ['position', 'normal', 'uv', 'uv1', 'color']) {
      const attribute = geometry.attributes[name] as VertexAttribute | undefined,
        location = this.locations[name];
      if (location < 0) continue;
      if (!attribute || 'isInterleavedBufferAttribute' in attribute) {
        gl.disableVertexAttribArray(location);
        if (name === 'color') gl.vertexAttrib4f(location, 1, 1, 1, 1);
        else gl.vertexAttrib2f(location, 0, 0);
        continue;
      }
      const entry = upload(gl, gl.ARRAY_BUFFER, attribute, cached.attributes.get(name));
      cached.attributes.set(name, entry);
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        attribute.itemSize,
        glType(gl, attribute.array),
        attribute.normalized,
        0,
        0,
      );
    }
  }
  dispose() {
    for (const entry of this.cache.values()) {
      this.gl.deleteVertexArray(entry.vao);
      if (entry.index) this.gl.deleteBuffer(entry.index.buffer);
      for (const attribute of entry.attributes.values()) this.gl.deleteBuffer(attribute.buffer);
    }
    this.cache.clear();
  }
}
