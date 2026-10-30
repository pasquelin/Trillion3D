import { floats } from '../../../../../../tests/kit/fakeDevice/fakeBuffers.ts'
import type { FakeTextureWrite } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { CUBE_MAX_LUMINANCE_BINDINGS, CUBE_MAX_LUMINANCE_ENTRY } from './cubePeakWgsl.ts'

/** The bind group of the last-mip kernel as the fake device keeps it: its view of the cube and the buffer it writes. */
type LastMipBind = {
  entries: { binding: number; resource: { texture?: object; buffer?: { data: Uint8Array } } }[]
}

/**
 * The GPU's answer to the last-mip kernel on a fake device (`FakeDeviceOptions.kernel`), for tests: the largest red, green or blue of every
 * texel the cube whose view it reads was uploaded with (`writes` is the device's `textureWrites`), written to the float it returns.
 */
export const cubePeakKernel =
  (writes: () => readonly FakeTextureWrite[]) => (entry: string, bind: unknown) => {
    if (entry !== CUBE_MAX_LUMINANCE_ENTRY) return undefined
    const { entries } = bind as LastMipBind
    const at = (binding: number) => entries.find((e) => e.binding === binding)!.resource
    return () => {
      const cube = at(CUBE_MAX_LUMINANCE_BINDINGS.last).texture
      let peak = 0
      for (const { destination, data } of writes())
        if (destination.texture === cube)
          for (let i = 0; i < data.length; i += 4)
            peak = Math.max(peak, data[i], data[i + 1], data[i + 2])
      floats(at(CUBE_MAX_LUMINANCE_BINDINGS.peak).buffer!.data)[0] = peak
    }
  }
