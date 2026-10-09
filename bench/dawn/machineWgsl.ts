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

/** A texel's taps on a 4 × 4 block about the thread's texel, wrapped in the 256² cached texture:
 *  loaded (`TEXEL_LOAD`), or filtered a quarter texel off the centres, four texels a tap. */
const taps = (read: string, sampler: string) => /* wgsl */ `
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> sink: array<vec4f>;${sampler}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  var sum = vec4f(0.0);
  for (var k = 0u; k < 16u; k++) {
    let at = (id.xy + vec2u(k & 3u, k >> 2u)) & vec2u(255u);
    sum += ${read};
  }
  if (sum.x == -1.0) { sink[id.x] = sum; }
}`
export const TEXEL_LOAD = taps('textureLoad(tex, at, 0)', '')
export const TEXEL_FILTER = taps(
  'textureSampleLevel(tex, linear, (vec2f(at) + 0.75) / 256.0, 0.0)',
  '\n@group(0) @binding(2) var linear: sampler;',
)
/** Two vec4f accumulators — eight independent chains — of 256 fused multiply-adds a thread. */
export const ALU = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> sink: array<vec4f>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  var a = vec4f(f32(id.x) * 1e-7, 0.5, 0.25, 0.125);
  var b = a + vec4f(1.0);
  for (var i = 0u; i < 256u; i++) { a = fma(a, vec4f(0.9999), vec4f(1e-4)); b = fma(b, vec4f(0.9999), vec4f(1e-4)); }
  let sum = a + b;
  if (sum.x == -1.0) { sink[id.x] = sum; }
}`
/** A 256-thread group's 256 vec4f of workgroup memory, each thread reading 256 of them. */
export const SHARED = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> sink: array<vec4f>;
var<workgroup> tile: array<vec4f, 256>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lid: u32) {
  tile[lid] = vec4f(f32(id.x));
  workgroupBarrier();
  var sum = vec4f(0.0);
  for (var i = 0u; i < 256u; i++) { sum += tile[(lid + i) & 255u]; }
  if (sum.x == -1.0) { sink[id.x] = sum; }
}`
/** A full-target triangle a fragment of noise to each of four attachments: 64 bits a texel, which
 *  no framebuffer compression shrinks. */
export const FILL_MRT4 = /* wgsl */ `
struct Out { @location(0) c0: vec4f, @location(1) c1: vec4f, @location(2) c2: vec4f, @location(3) c3: vec4f }
fn mix32(x: u32) -> u32 { var h = x; h = (h ^ (h >> 16u)) * 0x7feb352du; h = (h ^ (h >> 15u)) * 0x846ca68bu; return h ^ (h >> 16u); }
fn noise(p: vec2u, k: u32) -> vec4f { let h = mix32(p.x ^ mix32(p.y ^ mix32(k))); return vec4f(unpack2x16unorm(h), unpack2x16unorm(mix32(h))); }
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) at: vec4f) -> Out {
  let p = vec2u(at.xy);
  return Out(noise(p, 0u), noise(p, 1u), noise(p, 2u), noise(p, 3u));
}`
/** One triangle a pixel of a 2048² target, its corners pulled from the vertex index, each covering
 *  its pixel's centre; the fragment writes the triangle's rank. */
export const TRIANGLES = /* wgsl */ `
struct Vary { @builtin(position) at: vec4f, @location(0) @interpolate(flat) rank: u32 }
@vertex fn vs(@builtin(vertex_index) v: u32) -> Vary {
  let t = v / 3u;
  var corners = array(vec2f(0.0, 0.0), vec2f(1.25, 0.0), vec2f(0.0, 1.25));
  let p = (vec2f(f32(t % 2048u), f32(t / 2048u)) + corners[v % 3u]) / 2048.0 * 2.0 - 1.0;
  return Vary(vec4f(p.x, -p.y, 0.5, 1.0), t);
}
@fragment fn fs(in: Vary) -> @location(0) u32 { return in.rank; }`
