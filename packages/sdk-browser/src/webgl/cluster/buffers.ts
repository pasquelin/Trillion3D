import type { GpuBuffer } from '../../cluster/batchMesh.ts';

/** A GPU buffer holding the bytes of one engine buffer, at the version last uploaded. */
export type CachedAttribute = {
  buffer: WebGLBuffer;
  source: GpuBuffer;
  version: number;
  bytes: number;
};

export const glType = (gl: WebGL2RenderingContext, array: ArrayBufferView) => {
  if (array instanceof Float32Array) return gl.FLOAT;
  if (array instanceof Uint32Array) return gl.UNSIGNED_INT;
  if (array instanceof Int32Array) return gl.INT;
  if (array instanceof Uint16Array) return gl.UNSIGNED_SHORT;
  if (array instanceof Int16Array) return gl.SHORT;
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return gl.UNSIGNED_BYTE;
  if (array instanceof Int8Array) return gl.BYTE;
  throw new Error(`Unsupported cluster attribute ${array.constructor.name}`);
};

/** Uploads what changed of `attribute` since `known`, into its buffer or a new one. */
export const upload = (
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
