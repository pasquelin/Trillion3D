import { DISC_CORNERS } from './drawWords.ts';
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from '../webgpu/blend/displayFilter.ts';

// The particle kernels: the step (`webgpuParticles.ts`) and the draw (`webgpuParticleDraw.ts`).

/** Slots one workgroup steps. */
export const PARTICLE_WORKGROUP = 64;

/** One invocation per slot: the ring's record this image replaces it, then a live particle moves
 *  (position from the pool's origin); a dead one nobody emitted into is left as it is. The move is
 *  the exact one under a constant acceleration, `p += (v + a·dt/2)·dt` then `v += a·dt`: the
 *  velocity's end alone would add `a·dt²/2` a step, 0.33 m of fall over 2 s at 60 Hz. */
export const PARTICLES_WGSL = /* wgsl */ `
struct Particle { position: vec4f, velocity: vec4f }
struct Step { acceleration: vec3f, dt: f32, first: u32, count: u32, capacity: u32, pad: u32 }
@group(0) @binding(0) var<uniform> step: Step;
@group(0) @binding(1) var<storage, read> staged: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particles: array<Particle>;
@compute @workgroup_size(${PARTICLE_WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= step.capacity) { return; }
  let k = (i + step.capacity - step.first) % step.capacity;
  var p = particles[i];
  if (k < step.count) { p = staged[k]; } else if (p.position.w >= p.velocity.w) { return; }
  if (p.position.w < p.velocity.w) {
    let gain = step.acceleration * step.dt;
    p.position = vec4f(p.position.xyz + (p.velocity.xyz + 0.5 * gain) * step.dt, p.position.w + step.dt);
    p.velocity = vec4f(p.velocity.xyz + gain, p.velocity.w);
  }
  particles[i] = p;
}`;

/** Per slot, a disc facing the eye, fading with age, at its edge and near the scene's depth; its
 *  coverage is the reactive value (#833), so the temporal pass keeps no trail of it. */
export const PARTICLE_DRAW_WGSL = /* wgsl */ `
struct Particle { position: vec4f, velocity: vec4f }
struct Draw { clip: mat4x4f, unclip: mat4x4f, eye: vec3f, size: f32, color: vec4f, softness: f32, exposure: f32, curve: f32, unlit: f32, drawn: vec2f }
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var depth: texture_depth_2d;
struct Out { @builtin(position) at: vec4f, @location(0) corner: vec2f, @location(1) local: vec3f, @location(2) life: f32 }
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let p = particles[i];
  var o: Out;
  o.at = vec4f(2, 2, 2, 1);
  if (!(p.position.w < p.velocity.w)) { return o; }
  var corners = array(${DISC_CORNERS});
  let toEye = normalize(draw.eye - p.position.xyz);
  let right = normalize(cross(select(vec3f(0, 1, 0), vec3f(1, 0, 0), abs(toEye.y) > 0.99), toEye));
  o.corner = corners[v];
  o.local = p.position.xyz + (right * o.corner.x + cross(toEye, right) * o.corner.y) * draw.size;
  o.at = draw.clip * vec4f(o.local, 1);
  o.life = 1 - p.position.w / p.velocity.w;
  return o;
}
fn particle(in: Out) -> vec4f {
  let size = draw.drawn;
  let ndc = vec2f(in.at.x / size.x * 2 - 1, 1 - in.at.y / size.y * 2);
  let scene = draw.unclip * vec4f(ndc, textureLoad(depth, vec2i(in.at.xy), 0), 1);
  let behind = distance(scene.xyz / scene.w, draw.eye) - distance(in.local, draw.eye);
  let soft = select(1.0, saturate(behind / draw.softness), abs(scene.w) > 1e-20);
  let k = saturate(1 - dot(in.corner, in.corner)) * soft * in.life * draw.color.a;
  return vec4f(draw.color.rgb, 1) * k;
}
struct Lit { @location(0) color: vec4f, @location(1) reactive: vec4f }
@fragment fn fs(in: Out) -> Lit { let c = particle(in); return Lit(c, vec4f(0, 1, 0, c.a)); }`;

/** The draw of an image with display layers (\`../webgpu/blend/displayFilter.ts\`): where the mask
 *  is set, the disc maps the tint and the added value by its display colour, not the lit image. */
export const PARTICLE_ROUTED_WGSL = /* wgsl */ `${PARTICLE_DRAW_WGSL}${DISPLAY_ROUTE_WGSL}${displayMaskWgsl(1)}
struct Routed { @location(0) color: vec4f, @location(1) tint: vec4f, @location(2) add: vec4f, @location(3) reactive: vec4f }
@fragment fn fsRouted(in: Out) -> Routed {
  let c = particle(in);
  let r = displayRoute(draw.color.rgb, draw.exposure, u32(draw.curve), draw.unlit != 0, c.a, maskAt(in.at));
  return Routed(c * r.keep, r.tint, r.add, vec4f(0, 1, 0, c.a));
}`;
