import { mockGpu, type MockGpuOptions } from '../../../../../../tests/kit/gpu/mockGpu.ts';

type Made = { label?: string; size?: { width: number; height: number } };

/** The shared test device (`options`), answering each `kind` creation whose label holds `label`
 *  with `answer`, inside the scope it is made in: by default refused as out of memory. */
export function refusing(
  kind: 'createTexture' | 'createBuffer',
  label: string,
  answer: (raise: (message: string) => void, descriptor: Made) => void = (raise) =>
    raise('Out of memory'),
  options?: MockGpuOptions,
) {
  const gpu = mockGpu(options);
  const device = gpu.device as unknown as Record<string, (d: Made) => unknown>;
  const make = device[kind];
  device[kind] = function (this: unknown, descriptor: Made) {
    const made = make.call(this, descriptor);
    if (descriptor.label?.includes(label))
      answer((message) => gpu.raise(message), descriptor);
    return made;
  };
  return gpu;
}
