const none = () => undefined

/** A buffer binding read live: its buffer, offset and size resolved from their owners when read,
 *  its readers allocated once. */
export function liveBuffer(
  buffer: () => GPUBuffer | undefined,
  offset: () => number | undefined = none,
  size: () => number | undefined = none,
): GPUBufferBinding {
  return {
    get buffer() {
      return buffer()!
    },
    get offset() {
      return offset()
    },
    get size() {
      return size()
    },
  }
}

/** Entry descriptors read live resources; their arrays, bindings and readers are allocated once. */
export const bufferEntry = (
  binding: number,
  buffer: () => GPUBuffer | undefined,
  offset?: () => number | undefined,
  size?: () => number | undefined,
): GPUBindGroupEntry => ({ binding, resource: liveBuffer(buffer, offset, size) })
export function resourceEntry(
  binding: number,
  resource: () => GPUBindingResource | undefined,
): GPUBindGroupEntry {
  return {
    binding,
    get resource() {
      return resource()!
    },
  }
}
/** Resolve each resource from its owner when read, including after the owner replaces it. */
export function liveResources<T>(readers: { [K in keyof T]: () => T[K] | undefined }): T {
  const resources = {}
  for (const key of Object.keys(readers) as (keyof T)[])
    Object.defineProperty(resources, key, { get: readers[key] })
  return resources as T
}
