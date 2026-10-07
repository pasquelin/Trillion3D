// The kernels of the peak micro-benchmarks (`plan.ts`). Every read lands in a sum written only when
// it equals -1, which the zeroed inputs never give: the compiler keeps each read, and no write
// costs the run. Compute kernels run 256 threads a group, 8 × 8 over a texture.
import type { PeakBench } from './plan.ts'

/** The sink a kernel writes its sum to, never in practice; `slot` its index. */
const sink = (binding: number) =>
  `@group(0) @binding(${binding}) var<storage, read_write> sink: array<vec4f>;`
const spill = (sum: string, slot: string) => `if (${sum}.x == -1.0) { sink[${slot}] = ${sum}; }`

function stream({ size, resource }: PeakBench) {
  const { threads, perThread } = size
  const head = `const THREADS = ${threads}u;\nconst PER = ${perThread}u;`
  const main = (body: string) =>
    `${head}\n@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {\n${body}\n}`
  if (resource === 'read')
    return `@group(0) @binding(0) var<storage, read> src: array<vec4f>;\n${sink(1)}\n${main(
      `  var sum = vec4f(0.0);\n  for (var k = 0u; k < PER; k++) { sum += src[id.x + k * THREADS]; }\n  ${spill('sum', 'id.x')}`,
    )}`
  if (resource === 'write')
    return `@group(0) @binding(1) var<storage, read_write> dst: array<vec4f>;\n${main(
      '  for (var k = 0u; k < PER; k++) { dst[id.x + k * THREADS] = vec4f(f32(id.x), f32(k), 0.0, 1.0); }',
    )}`
  return `@group(0) @binding(0) var<storage, read> src: array<vec4f>;\n@group(0) @binding(1) var<storage, read_write> dst: array<vec4f>;\n${main(
    '  for (var k = 0u; k < PER; k++) { let i = id.x + k * THREADS; dst[i] = src[i]; }',
  )}`
}

function texels({ size, resource }: PeakBench) {
  const sampler = resource === 'texelFilter' ? '\n@group(0) @binding(2) var linear: sampler;' : ''
  const head = `@group(0) @binding(0) var tex: texture_2d<f32>;\n${sink(1)}${sampler}`
  const main = (body: string) =>
    `${head}\n@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {\n${body}\n}`
  if (resource === 'textureStream')
    return main(
      `  let p = id.xy * 2u;\n  let v = textureLoad(tex, p, 0) + textureLoad(tex, p + vec2u(1u, 0u), 0) + textureLoad(tex, p + vec2u(0u, 1u), 0) + textureLoad(tex, p + vec2u(1u), 0);\n  ${spill('v', 'id.x')}`,
    )
  const side = size.side
  // Taps on a 4 × 4 block around the thread's texel, wrapped in the cached texture.
  const at = `(id.xy + vec2u(k & 3u, k >> 2u)) & vec2u(${side - 1}u)`
  const read =
    resource === 'texelLoad'
      ? `textureLoad(tex, ${at}, 0)`
      : // A quarter texel off the centres: every tap blends four texels.
        `textureSampleLevel(tex, linear, (vec2f(${at}) + 0.75) / ${side}.0, 0.0)`
  return main(
    `  var sum = vec4f(0.0);\n  for (var k = 0u; k < ${size.taps}u; k++) { sum += ${read}; }\n  ${spill('sum', 'id.x')}`,
  )
}

function alu({ size }: PeakBench) {
  return `${sink(0)}
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) id: vec3u) {
  var a = vec4f(f32(id.x) * 1e-7, 0.5, 0.25, 0.125);
  var b = a + vec4f(1.0);
  let m = vec4f(0.9999);
  let c = vec4f(1e-4);
  for (var i = 0u; i < ${size.iterations}u; i++) { a = fma(a, m, c); b = fma(b, m, c); }
  let sum = a + b;
  ${spill('sum', 'id.x')}
}`
}

function shared({ size }: PeakBench) {
  return `${sink(0)}
var<workgroup> tile: array<vec4f, 256>;
@compute @workgroup_size(256) fn main(
  @builtin(global_invocation_id) id: vec3u,
  @builtin(local_invocation_index) lid: u32,
) {
  tile[lid] = vec4f(f32(id.x));
  workgroupBarrier();
  var sum = vec4f(0.0);
  for (var i = 0u; i < ${size.reads}u; i++) { sum += tile[(lid + i) & 255u]; }
  ${spill('sum', 'id.x')}
}`
}

/** A full-screen triangle, its fragment a hash of its pixel to each attachment: every texel holds
 *  64 bits of noise, which no framebuffer compression shrinks, so a pixel stored is 8 bytes moved. */
function fill({ size }: PeakBench) {
  const outputs = Array.from({ length: size.attachments }, (_, k) => `@location(${k}) c${k}: vec4f`)
  const values = Array.from({ length: size.attachments }, (_, k) => `noise(p, ${k}u)`)
  return `struct Out { ${outputs.join(', ')} }
fn mix32(x: u32) -> u32 { var h = x; h = (h ^ (h >> 16u)) * 0x7feb352du; h = (h ^ (h >> 15u)) * 0x846ca68bu; return h ^ (h >> 16u); }
fn noise(p: vec2u, k: u32) -> vec4f {
  let h = mix32(p.x ^ mix32(p.y ^ mix32(k)));
  return vec4f(unpack2x16unorm(h), unpack2x16unorm(mix32(h)));
}
@vertex fn vs(@builtin(vertex_index) v: u32) -> @builtin(position) vec4f {
  let q = vec2f(f32((v << 1u) & 2u), f32(v & 2u));
  return vec4f(q * 2.0 - 1.0, 0.5, 1.0);
}
@fragment fn fs(@builtin(position) at: vec4f) -> Out { let p = vec2u(at.xy); return Out(${values.join(', ')}); }`
}

/** One triangle a pixel of a `side`² target, its corners pulled from the vertex index, each
 *  covering its pixel's centre; the fragment writes the triangle's rank. */
function triangles({ size }: PeakBench) {
  const side = size.side
  return `struct Vary { @builtin(position) at: vec4f, @location(0) @interpolate(flat) rank: u32 }
@vertex fn vs(@builtin(vertex_index) v: u32) -> Vary {
  let t = v / 3u;
  var corners = array(vec2f(0.0, 0.0), vec2f(1.25, 0.0), vec2f(0.0, 1.25));
  let corner = corners[v % 3u];
  let pixel = vec2f(f32(t % ${side}u), f32(t / ${side}u));
  let p = (pixel + corner) / ${side}.0 * 2.0 - 1.0;
  return Vary(vec4f(p.x, -p.y, 0.5, 1.0), t);
}
@fragment fn fs(in: Vary) -> @location(0) u32 { return in.rank; }`
}

const EMPTY = `${sink(0)}
@compute @workgroup_size(1) fn main() { if (sink[0].x == -1.0) { sink[1] = sink[0]; } }`

/** The WGSL of `bench`, or `null` for a pass with no program (`renderPass`). */
export function peakWgsl(bench: PeakBench): string | null {
  switch (bench.resource) {
    case 'read':
    case 'write':
    case 'copy':
      return stream(bench)
    case 'textureStream':
    case 'texelLoad':
    case 'texelFilter':
      return texels(bench)
    case 'alu':
      return alu(bench)
    case 'shared':
      return shared(bench)
    case 'fill':
    case 'fillMrt4':
    case 'fragments':
      return fill(bench)
    case 'triangles':
      return triangles(bench)
    case 'computePass':
    case 'dependentDispatch':
      return EMPTY
    case 'renderPass':
      return null
  }
}
