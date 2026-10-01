/** h is displacement about mean depth; y/z are horizontal velocities. Zero exterior cells
 *  provide a dissipative open boundary. This is linearised shallow water, not a sinusoidal fake. */
export const STEP_WGSL = `
struct Parameters { physical: vec4f, shift: vec4i }
@group(0) @binding(0) var<uniform> p: Parameters;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var destination: texture_storage_2d<rgba16float, write>;
fn cell(at: vec2i) -> vec3f {
  let n = vec2i(textureDimensions(source));
  if (any(at < vec2i(0)) || any(at >= n)) { return vec3f(0.0); }
  return textureLoad(source, at, 0).xyz;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let at = vec2i(id.xy);
  if (any(id.xy >= textureDimensions(source))) { return; }
  let dt = p.physical.x;
  let middle = cell(at + p.shift.xy);
  if (dt == 0.0) { textureStore(destination, at, vec4f(middle, 0.0)); return; }
  let left = cell(at + vec2i(-1, 0)); let right = cell(at + vec2i(1, 0));
  let down = cell(at + vec2i(0, -1)); let up = cell(at + vec2i(0, 1));
  let depth = p.physical.z;
  let ratio = dt / p.physical.y;
  let flux = vec3f(depth * (right.y - left.y + up.z - down.z),
    9.81 * (right.x - left.x), 9.81 * (up.x - down.x));
  let diffusion = 0.5 * sqrt(9.81 * depth) * ratio * (left + right + down + up - 4.0 * middle);
  let next = (middle - 0.5 * ratio * flux + diffusion) * p.physical.w;
  textureStore(destination, at, vec4f(next, 0.0));
}`;

export const SPLAT_WGSL = `
@group(0) @binding(0) var<uniform> extent: vec4f;
struct Vertex { @builtin(position) position: vec4f, @location(0) local: vec2f,
  @location(1) strength: f32 }
@vertex fn vertex(@builtin(vertex_index) id: u32, @location(0) record: vec4f) -> Vertex {
  let corners = array<vec2f, 6>(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1),
    vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
  let local = corners[id]; let world = record.xy + local * record.z;
  var out: Vertex;
  out.position = vec4f(world.x * 2.0 / extent.x, -world.y * 2.0 / extent.x, 0, 1);
  out.local = local; out.strength = record.w; return out;
}
@fragment fn fragment(in: Vertex) -> @location(0) vec4f {
  let weight = max(0.0, 1.0 - dot(in.local, in.local));
  return vec4f(in.strength * weight * weight, 0, 0, 0);
}`;
