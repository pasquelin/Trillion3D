import { COMPUTE } from '../../gpu/core/computeBindings.ts';
import { UNI_WORDS } from './runs.ts';

/** Group-0 binding of each buffer the expansion kernel reads, under its WGSL name. */
export const EXPAND_BINDING = {
  uni: 0,
  plan: 1,
  keep: 2,
  draws: 3,
  counts: 4,
  clusters: 5,
  scratch: 6,
  expanded: 7,
  args: 8,
} as const;

const read = 'read-only-storage',
  write = 'storage';
const STORAGE_TYPES: Record<Exclude<keyof typeof EXPAND_BINDING, 'uni'>, GPUBufferBindingType> = {
  plan: read,
  keep: read,
  draws: read,
  counts: read,
  clusters: read,
  scratch: write,
  expanded: write,
  args: write,
};

/**
 * Group-0 bindings, published under the WGSL that declares them: the uniform at its dynamic
 * offset, then the eight storage buffers. The production layout and the browser probe READ them
 * here — none copies them, so none can lag behind the shader.
 */
export function blendExpandBindEntries(): GPUBindGroupLayoutEntry[] {
  return [
    {
      binding: EXPAND_BINDING.uni,
      visibility: COMPUTE,
      buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: UNI_WORDS * 4 },
    },
    ...Object.entries(STORAGE_TYPES).map(([name, type]) => ({
      binding: EXPAND_BINDING[name as keyof typeof STORAGE_TYPES],
      visibility: COMPUTE,
      buffer: { type },
    })),
  ].sort((a, b) => a.binding - b.binding);
}
