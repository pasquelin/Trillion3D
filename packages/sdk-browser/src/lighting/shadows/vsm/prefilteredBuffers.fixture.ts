// What the prefiltered distant shadow's buffer tests share (`prefilteredBuffers.test.ts`,
// `prefilteredFrame.test.ts`): a fake device with the limits the buffers need, and a page management frame.
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { VsmPageManagementFrame } from './pageManagementPass.ts'

const PAGE_OPTIONS = { stats: false, lruAllocation: true, fullClears: false } as const

export const device = () =>
  fakeDevice({
    limits: { maxStorageBuffersPerShaderStage: 10, maxStorageBufferBindingSize: 1 << 27 },
  })

export const frameOf = (fake: ReturnType<typeof device>, mapCount = 5): VsmPageManagementFrame => ({
  ...{ device: fake.device, mapCount, nextMapCount: 7 },
  perPageBins: [3, 2, 1, 4].map((count, b) => ({ offset: 2 * b, count })),
  directionalBins: [1, 0, 2, 0].map((count, b) => ({ offset: 2 * b, count })),
  options: { ...PAGE_OPTIONS, skipDynamicInvalidation: false },
})
