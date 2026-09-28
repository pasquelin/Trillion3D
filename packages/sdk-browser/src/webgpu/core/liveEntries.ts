/** Entry descriptors read live resources; their arrays, bindings and readers are allocated once. */
export function bufferEntry(
  binding: number,
  buffer: () => GPUBuffer | undefined,
  offset: () => number | undefined = () => undefined,
  size: () => number | undefined = () => undefined,
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
