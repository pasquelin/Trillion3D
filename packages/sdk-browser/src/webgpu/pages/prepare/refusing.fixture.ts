import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';

/** The shared test device, answering each `kind` creation whose label holds `label` with
 *  `answer`, inside the scope it is made in: by default refused as out of memory. */
export function refusing(
  kind: 'createTexture' | 'createBuffer',
  label: string,
  answer: (raise: (message: string) => void) => void = (raise) => raise('Out of memory'),
) {
  const gpu = mockGpu();
  const device = gpu.device as unknown as Record<string, (d: { label?: string }) => unknown>;
  const make = device[kind];
  device[kind] = function (this: unknown, descriptor: { label?: string }) {
    const made = make.call(this, descriptor);
    if (descriptor.label?.includes(label)) answer((message) => gpu.raise(message));
    return made;
  };
  return gpu;
}
