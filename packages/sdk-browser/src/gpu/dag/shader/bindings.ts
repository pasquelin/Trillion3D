import { COMPUTE } from '../../core/computeBindings.ts';

/** Group-0 binding of each buffer the selection kernel reads, under its WGSL name. */
export const DAG_BINDING = {
  clusters: 0,
  nodes: 1,
  views: 2,
  flags: 3,
  out: 4,
  work: 5,
  worlds: 6,
  frames: 7,
  cold: 8,
} as const;

const B = DAG_BINDING;

/** Group-0 declarations of the selection kernel; `shader.ts` inlines them as they stand. */
export const DAG_BINDINGS_WGSL = `@group(0) @binding(${B.clusters}) var<storage, read> clusters:array<Cluster>;
@group(0) @binding(${B.nodes}) var<storage, read> nodes:array<CullNode>;
@group(0) @binding(${B.views}) var<uniform> views:array<Uniforms,MAX_VIEWS>;
@group(0) @binding(${B.flags}) var<storage, read_write> flags:array<u32>;
@group(0) @binding(${B.out}) var<storage, read_write> out:Output;
@group(0) @binding(${B.work}) var<storage, read_write> work:array<atomic<u32>>;
@group(0) @binding(${B.worlds}) var<storage, read> worlds:array<mat4x4f>;
@group(0) @binding(${B.frames}) var<storage, read_write> frames:array<vec4f>;
@group(0) @binding(${B.cold}) var<storage, read> cold:array<u32>;`;

const read = 'read-only-storage',
  write = 'storage';
const DAG_TYPES: Record<keyof typeof DAG_BINDING, GPUBufferBindingType> = {
  clusters: read,
  nodes: read,
  views: 'uniform',
  flags: write,
  out: write,
  work: write,
  worlds: read,
  frames: write,
  cold: read,
};

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * browser probes READ them here — none copies them, so none can lag behind the shader.
 */
export function dagBindEntries(): GPUBindGroupLayoutEntry[] {
  return Object.entries(DAG_BINDING)
    .map(([name, binding]) => ({
      binding,
      visibility: COMPUTE,
      buffer: { type: DAG_TYPES[name as keyof typeof DAG_BINDING] },
    }))
    .sort((a, b) => a.binding - b.binding);
}
