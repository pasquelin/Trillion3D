/** Allocate all buffers together; a failed allocation releases every earlier one. */
export function createTimingResources(device: GPUDevice, queryCount: number) {
  let query: GPUQuerySet | undefined;
  let resolve: GPUBuffer | undefined;
  let read: GPUBuffer | undefined;
  try {
    const bytes = queryCount * 8;
    query = device.createQuerySet({ type: 'timestamp', count: queryCount });
    resolve = device.createBuffer({
      label: 'WG timestamp resolve',
      size: bytes,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    read = device.createBuffer({
      label: 'WG timestamp readback',
      size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    return { query, resolve, read };
  } catch (error) {
    query?.destroy();
    resolve?.destroy();
    read?.destroy();
    throw error;
  }
}

export type TimingPart = { slot: number; names: string[]; resolved: boolean };

/** Attach timestamp writes to every pass and resolve them when the encoder finishes. */
export function instrumentTimingEncoder(
  encoder: GPUCommandEncoder,
  part: TimingPart,
  state: { truncated: boolean },
  resources: { query: GPUQuerySet; resolve: GPUBuffer; read: GPUBuffer },
  maxPasses: number,
  partQueries: number,
): GPUCommandEncoder {
  const { query, resolve, read } = resources;
  return new Proxy(encoder, {
    get(target, key) {
      if (key === 'beginRenderPass' || key === 'beginComputePass')
        return (descriptor: GPURenderPassDescriptor | GPUComputePassDescriptor = {}) => {
          let instrumented = descriptor;
          if (part.names.length < maxPasses && !descriptor.timestampWrites) {
            const index = part.slot * partQueries + part.names.length * 2;
            part.names.push(descriptor.label ?? String(key));
            instrumented = {
              ...descriptor,
              timestampWrites: {
                querySet: query,
                beginningOfPassWriteIndex: index,
                endOfPassWriteIndex: index + 1,
              },
            };
          } else state.truncated = true;
          return key === 'beginRenderPass'
            ? target.beginRenderPass(instrumented as GPURenderPassDescriptor)
            : target.beginComputePass(instrumented);
        };
      if (key === 'finish')
        return (descriptor?: GPUCommandBufferDescriptor) => {
          if (part.names.length) {
            const base = part.slot * partQueries;
            target.resolveQuerySet(query, base, part.names.length * 2, resolve, base * 8);
            target.copyBufferToBuffer(resolve, base * 8, read, base * 8, part.names.length * 16);
            part.resolved = true;
          }
          return target.finish(descriptor);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
