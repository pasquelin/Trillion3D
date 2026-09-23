/** Query slot of the part `index`: the timing module gives each encoder its own aligned block. */
export const PART = 128;

export function fixture(supported = true) {
  Object.assign(globalThis, {
    GPUBufferUsage: { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 },
    GPUMapMode: { READ: 1 },
  });
  const descriptors: any[] = [],
    ops: string[] = [],
    buffers: any[] = [];
  let destroys = 0;
  const device = {
    features: new Set(supported ? ['timestamp-query'] : []),
    createQuerySet: () => ({
      destroy() {
        destroys++;
      },
    }),
    createBuffer: () => {
      const data = new BigUint64Array(PART * 4);
      data.set([1000000n, 3000000n], 0);
      data.set([4000000n, 7000000n], PART);
      const buffer = {
        mapAsync: async () => {},
        getMappedRange: () => data.buffer,
        unmap() {},
        destroy() {
          destroys++;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
    createCommandEncoder: () => ({
      beginRenderPass(d: any) {
        descriptors.push(d);
        return { end() {} };
      },
      beginComputePass(d: any) {
        descriptors.push(d);
        return { end() {} };
      },
      resolveQuerySet(...a: unknown[]) {
        ops.push('resolve ' + a[1] + ' ' + a[2] + ' @' + a[4]);
      },
      copyBufferToBuffer(...a: unknown[]) {
        ops.push('copy ' + a[1] + ' -> ' + a[3] + ' x' + a[4]);
      },
      finish() {
        ops.push('finish');
        return {};
      },
    }),
  } as unknown as GPUDevice;
  return { device, descriptors, ops, buffers, destroys: () => destroys };
}
