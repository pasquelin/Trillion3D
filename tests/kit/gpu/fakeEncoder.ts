import type { FakeCopy, FakeTextureCopy } from './fakeRecords.ts'

/** The command encoder of the fake device (`fakeDevice.ts`): its copies recorded in `copies` and
 *  `textureCopies`, its compute passes recording nothing — a test reads what the queue was
 *  handed. */
export const fakeEncoder = (copies: FakeCopy[], textureCopies: FakeTextureCopy[]) => ({
  copyBufferToBuffer: (
    from: GPUBuffer,
    fromOffset: number,
    to: GPUBuffer,
    toOffset: number,
    size: number,
  ) => void copies.push({ from, fromOffset, to, toOffset, size }),
  clearBuffer() {},
  beginComputePass: () => ({
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups() {},
    dispatchWorkgroupsIndirect() {},
    pushDebugGroup() {},
    popDebugGroup() {},
    end() {},
  }),
  copyTextureToTexture: (
    from: GPUTexelCopyTextureInfo,
    to: GPUTexelCopyTextureInfo,
    size: GPUExtent3D,
  ) => void textureCopies.push({ from, to, size }),
  finish: () => ({}),
})
