const none = () => undefined;

/** Entry descriptors read live resources; their arrays, bindings and readers are allocated once. */
export function bufferEntry(
  binding: number,
  buffer: () => GPUBuffer | undefined,
  offset: () => number | undefined = none,
  size: () => number | undefined = none,
): GPUBindGroupEntry {
  return {
    binding,
    resource: {
      get buffer() {
        return buffer()!;
      },
      get offset() {
        return offset();
      },
      get size() {
        return size();
      },
    },
  };
}
/** A buffer bound whole, or one range of a buffer: the float pool's normals are a range of its
 *  position buffer (`geometryPoolLayout.ts`, #1410). */
export type BufferRange = GPUBuffer | GPUBufferBinding;
const isRange = (range: BufferRange | undefined): range is GPUBufferBinding =>
  !!range && 'buffer' in range;
/** `bufferEntry` of a buffer or of a range, read live; nothing allocated. */
export function rangeEntry(binding: number, range: () => BufferRange | undefined) {
  const buffer = () => {
    const r = range();
    return isRange(r) ? r.buffer : r;
  };
  const part = (key: 'offset' | 'size') => () => {
    const r = range();
    return isRange(r) ? r[key] : undefined;
  };
  return bufferEntry(binding, buffer, part('offset'), part('size'));
}
export function resourceEntry(
  binding: number,
  resource: () => GPUBindingResource | undefined,
): GPUBindGroupEntry {
  return {
    binding,
    get resource() {
      return resource()!;
    },
  };
}
/** Resolve each resource from its owner when read, including after the owner replaces it. */
export function liveResources<T>(readers: { [K in keyof T]: () => T[K] | undefined }): T {
  const resources = {};
  for (const key of Object.keys(readers) as (keyof T)[])
    Object.defineProperty(resources, key, { get: readers[key] });
  return resources as T;
}
