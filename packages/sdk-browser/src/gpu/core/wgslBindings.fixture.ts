import { COMPUTE } from './computeBindings.ts';

/**
 * Group-0 buffer bindings a WGSL text declares, as the layout type each one requires: what a
 * test holds a published `*BindEntries()` against, so the entries cannot drift from the shader.
 */
export function wgslBufferBindings(shader: string) {
  const declared = /@group\(0\)\s*@binding\((\d+)\)\s*var<([^>]*)>/g;
  return Array.from(shader.matchAll(declared), ([, binding, space]) => {
    const [kind, access = 'read'] = space.split(',').map((part) => part.trim());
    const type: GPUBufferBindingType =
      kind === 'uniform' ? 'uniform' : access === 'read' ? 'read-only-storage' : 'storage';
    return { binding: Number(binding), type };
  }).sort((a, b) => a.binding - b.binding);
}

/** The same pairs, read from the layout entries. Every entry must be a compute-stage buffer. */
export const entryBufferBindings = (entries: GPUBindGroupLayoutEntry[]) =>
  entries.map(({ binding, visibility, buffer }) => ({
    binding,
    type: visibility === COMPUTE ? buffer?.type : undefined,
  }));
