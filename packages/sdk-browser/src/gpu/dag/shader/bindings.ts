/** `GPUShaderStage.COMPUTE`, written in the clear: this module is also read from Node, without that global. */
const COMPUTE = 4;

/** Group-0 declarations of the selection kernel; `shader.ts` inlines them as they stand. */
export const DAG_BINDINGS_WGSL = `@group(0) @binding(0) var<storage, read> clusters:array<Cluster>;
@group(0) @binding(1) var<storage, read> nodes:array<CullNode>;
@group(0) @binding(2) var<uniform> views:array<Uniforms,MAX_VIEWS>;
@group(0) @binding(3) var<storage, read_write> flags:array<u32>;
@group(0) @binding(4) var<storage, read_write> out:Output;
@group(0) @binding(5) var<storage, read_write> work:array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> worlds:array<mat4x4f>;
@group(0) @binding(7) var<storage, read_write> frames:array<vec4f>;
@group(0) @binding(8) var<storage, read> cold:array<u32>;`;

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * browser probes READ them here — none copies them, so none can lag behind the shader.
 */
export function dagBindEntries(): GPUBindGroupLayoutEntry[] {
  const read = 'read-only-storage',
    write = 'storage';
  return ([read, read, 'uniform', write, write, write, read, write, read] as const).map(
    (type, binding) => ({ binding, visibility: COMPUTE, buffer: { type } }),
  );
}
