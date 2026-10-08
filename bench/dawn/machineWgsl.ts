// The WGSL of the machine's kernels (`machineKernels.ts`): each streams or launches a fixed amount of
// work, 128 MiB or `THREAD_GROUPS` workgroups, whose time gives a rate.

export const READ = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> sink: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  let total = arrayLength(&src) / 8u;
  var sum = vec4f(0.0);
  for (var k = 0u; k < 8u; k++) { sum += src[id.x + k * total]; }
  sink[id.x] = sum.x + sum.y + sum.z + sum.w;
}`
export const WRITE = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> dst: array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  let total = arrayLength(&dst) / 8u;
  for (var k = 0u; k < 8u; k++) { dst[id.x + k * total] = vec4f(f32(id.x), f32(k), 1.0, 1.0); }
}`
export const TEXTURE_READ = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> sink: array<f32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  var sum = vec4f(0.0);
  for (var k = 0u; k < 16u; k++) {
    let at = id.x + k * 1048576u;
    sum += textureLoad(src, vec2u(at % 4096u, at / 4096u), 0);
  }
  sink[id.x] = sum.x + sum.y + sum.z + sum.w;
}`
export const TEXTURE_WRITE = /* wgsl */ `
@group(0) @binding(0) var dst: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  for (var k = 0u; k < 16u; k++) {
    let at = id.x + k * 1048576u;
    textureStore(dst, vec2u(at % 4096u, at / 4096u), vec4f(f32(id.x), f32(k), 1.0, 1.0));
  }
}`
export const TRIVIAL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> sink: array<u32>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x == 0xFFFFFFFFu) { sink[0] = 1u; }
}`
export const CHAINED = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> sink: array<u32>;
@compute @workgroup_size(1) fn main() { sink[0] = sink[0] + 1u; }`
export const FILL = /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.25, 0.5, 0.75, 1.0); }`
