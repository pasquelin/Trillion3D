import { BACKEND, type FakeDeviceOptions } from '../../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'

type Made = { label?: string; size?: { width: number; height: number } }

/** A descriptor's size as a dictionary, whichever form the engine gave it (`GPUExtent3D`). */
const sizeOf = (size: unknown): Made['size'] =>
  Array.isArray(size) ? { width: size[0], height: size[1] ?? 1 } : (size as Made['size'])

/** The shared test device (`options`), answering each `kind` creation whose label holds `label`
 *  with `answer` — its size read as a dictionary —, inside the scope it is made in: by default
 *  refused as out of memory. */
export function refusing(
  kind: 'createTexture' | 'createBuffer',
  label: string,
  answer: (raise: (message: string) => void, descriptor: Made) => void = (raise) =>
    raise('Out of memory'),
  options?: FakeDeviceOptions,
) {
  const gpu = fakeDevice({ ...BACKEND, ...options })
  const device = gpu.device as unknown as Record<string, (d: Made) => unknown>
  const make = device[kind]
  device[kind] = function (this: unknown, descriptor: Made) {
    const made = make.call(this, descriptor)
    if (descriptor.label?.includes(label))
      answer((message) => gpu.raise(message), { ...descriptor, size: sizeOf(descriptor.size) })
    return made
  }
  return gpu
}
