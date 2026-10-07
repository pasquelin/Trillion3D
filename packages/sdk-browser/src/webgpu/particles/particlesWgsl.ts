import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from '../blend/displayFilter.ts'

// The particle kernels: the step (`webgpuParticles.ts`) and the draw (`webgpuParticleDraw.ts`).

/** Slots one workgroup steps. */
const PARTICLE_WORKGROUP = 64

/** Vertices of a disc: two triangles as one strip (`DISC_TOPOLOGY`). */
export const DISC_VERTICES = 4
/** The disc's topology: corner `v` at `(v & 1, v >> 1)` scaled to ±1, the strip's two triangles
 *  the square's halves. */
export const DISC_TOPOLOGY: GPUPrimitiveTopology = 'triangle-strip'

/** Bytes of a pool's state before its particles: the draw's indirect arguments — a disc's
 *  vertices, the instances the step's window holds — then the window's first slot and three pad
 *  words. */
export const PARTICLE_STATE_HEAD = 32

/** Bytes of a step workgroup's partial window: its lowest live slot as a complement, one past its
 *  highest, 0 and 0 without one. */
export const PARTICLE_PARTIAL_BYTES = 8

/** A pool's state as the step writes it: the window (`PARTICLE_STATE_HEAD`), then the slots. */
const STATE_WGSL = `
struct Particle { position: vec4f, velocity: vec4f }
struct Window { vertices: u32, instances: u32, firstVertex: u32, firstInstance: u32, first: u32, pad0: u32, pad1: u32, pad2: u32 }
struct State { window: Window, particles: array<Particle> }`

/** The max of 64 lanes' pairs through a workgroup array, six halvings: every lane gets it. */
const LANES_FOLD_WGSL = `
var<workgroup> lanes: array<vec2u, ${PARTICLE_WORKGROUP}>;
fn foldLanes(local: u32, span: vec2u) -> vec2u {
  lanes[local] = span;
  for (var half = ${PARTICLE_WORKGROUP / 2}u; half > 0u; half >>= 1u) {
    workgroupBarrier();
    if (local < half) { lanes[local] = max(lanes[local], lanes[local + half]); }
  }
  workgroupBarrier();
  return lanes[0];
}`

/** The step's fold of its lanes: by subgroup, the subgroups' leaders then joining two workgroup
 *  words — one pair of atomics a subgroup, not one a live slot —; else the array fold. */
const stepFoldWgsl = (subgroups: boolean) =>
  subgroups
    ? `
var<workgroup> low: atomic<u32>;
var<workgroup> high: atomic<u32>;
fn foldStep(local: u32, span: vec2u) -> vec2u {
  let held = subgroupMax(span);
  if (subgroupElect() && held.y != 0u) { atomicMax(&low, held.x); atomicMax(&high, held.y); }
  workgroupBarrier();
  return vec2u(atomicLoad(&low), atomicLoad(&high));
}`
    : `${LANES_FOLD_WGSL}
fn foldStep(local: u32, span: vec2u) -> vec2u { return foldLanes(local, span); }`

/** Bytes of a pool's window dispatch: its workgroups, then 1 and 1, written by `bound`. */
export const PARTICLE_ARGS_BYTES = 12

/** The workgroups covering `slots` slots. */
export const particleGroups = (slots: number) => Math.ceil(slots / PARTICLE_WORKGROUP)

/** One invocation per slot that can change: `main` over the window of the slots alive after the
 *  last step, its workgroups the dispatch `bound` wrote; `emit` over the ring's records of this
 *  image, `[first, first + count)` around the capacity. A slot is replaced by its record when the
 *  ring holds one — so a slot both cover ends the same —, then a live particle moves (position
 *  from the pool's origin); a dead one nobody emitted into is left as it is, and a slot outside
 *  both is neither alive nor written: the cost follows the live window and the records, not the
 *  slots ever used. The move is the exact one under a constant acceleration, `p += (v + a·dt/2)·dt`
 *  then `v += a·dt`: the velocity's end alone would add `a·dt²/2` a step, 0.33 m of fall over 2 s
 *  at 60 Hz. Each lane then holds its slot's span — its complement and one past it, alive after
 *  the step, else 0 —, the workgroup folds them (`subgroups`: by subgroup, else through its
 *  memory) and its first lane stores the fold in the workgroup's partial — the window's from 0,
 *  the records' past the capacity's workgroups —: no device atomic. `bound`, one workgroup
 *  dispatched after the pools' steps, folds the partials both dispatches wrote — a strided max a
 *  lane, then the same fold, by subgroup where the device has them —, writes the window as the
 *  draw's first slot and instance count, and the next window's workgroups. The draw then takes the
 *  live slots' span in slot order, never a slot past it (#755). */
export const particlesWgsl = (
  subgroups: boolean,
) => /* wgsl */ `${subgroups ? 'enable subgroups;' : ''}${STATE_WGSL}
struct Step { acceleration: vec3f, dt: f32, first: u32, count: u32, capacity: u32, groups: u32 }
@group(0) @binding(0) var<uniform> step: Step;
@group(0) @binding(1) var<storage, read> staged: array<Particle>;
@group(0) @binding(2) var<storage, read_write> state: State;
@group(0) @binding(3) var<storage, read_write> partials: array<vec2u>;
@group(0) @binding(4) var<storage, read_write> args: array<u32>;
${stepFoldWgsl(subgroups)}
fn stepSlot(i: u32) -> bool {
  let d = i - step.first;
  let k = select(d, d + step.capacity, i < step.first);
  var p = state.particles[i];
  if (k < step.count) { p = staged[k]; } else if (p.position.w >= p.velocity.w) { return false; }
  if (p.position.w < p.velocity.w) {
    let gain = step.acceleration * step.dt;
    p.position = vec4f(p.position.xyz + (p.velocity.xyz + 0.5 * gain) * step.dt, p.position.w + step.dt);
    p.velocity = vec4f(p.velocity.xyz + gain, p.velocity.w);
  }
  state.particles[i] = p;
  return p.position.w < p.velocity.w;
}
fn spanOf(i: u32, alive: bool) -> vec2u { return select(vec2u(0u), vec2u(~i, i + 1u), alive); }
fn windowGroups() -> u32 { return (step.capacity + ${PARTICLE_WORKGROUP - 1}u) / ${PARTICLE_WORKGROUP}u; }
@compute @workgroup_size(${PARTICLE_WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) local: u32, @builtin(workgroup_id) wg: vec3u) {
  let i = state.window.first + id.x;
  let span = foldStep(local, spanOf(i, id.x < state.window.instances && stepSlot(i)));
  if (local == 0u) { partials[wg.x] = span; }
}
@compute @workgroup_size(${PARTICLE_WORKGROUP})
fn emit(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) local: u32, @builtin(workgroup_id) wg: vec3u) {
  let j = step.first + id.x;
  let i = select(j, j - step.capacity, j >= step.capacity);
  let span = foldStep(local, spanOf(i, id.x < step.count && stepSlot(i)));
  if (local == 0u) { partials[windowGroups() + wg.x] = span; }
}
@compute @workgroup_size(${PARTICLE_WORKGROUP})
fn bound(@builtin(local_invocation_index) local: u32) {
  var span = vec2u(0u);
  let stepped = args[0];
  for (var g = local; g < stepped; g += ${PARTICLE_WORKGROUP}u) { span = max(span, partials[g]); }
  for (var g = local; g < step.groups; g += ${PARTICLE_WORKGROUP}u) { span = max(span, partials[windowGroups() + g]); }
  span = foldStep(local, span);
  if (local == 0u) {
    let first = select(0u, ~span.x, span.y != 0u);
    state.window.first = first;
    state.window.instances = span.y - first;
    args[0] = (span.y - first + ${PARTICLE_WORKGROUP - 1}u) / ${PARTICLE_WORKGROUP}u;
  }
}`

/** Per slot of the step's window, a disc facing the eye, fading with age, at its edge and near
 *  the scene's depth; one module, two fragment entries. `fs`: its coverage is the reactive value
 *  (#833), so the temporal pass keeps no trail of it. `fsRouted`, an image with display layers
 *  (`../blend/displayFilter.ts`): where the mask is set, the disc maps the tint and the added
 *  value by its display colour, not the lit image. */
export const PARTICLE_DRAW_WGSL = /* wgsl */ `${STATE_WGSL}
struct Draw { clip: mat4x4f, unclip: mat4x4f, eye: vec3f, size: f32, color: vec4f, softness: f32, exposure: f32, curve: f32, unlit: f32, drawn: vec2f }
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var<storage, read> state: State;
@group(0) @binding(2) var depth: texture_depth_2d;
struct Out { @builtin(position) at: vec4f, @location(0) corner: vec2f, @location(1) local: vec3f, @location(2) life: f32 }
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  let p = state.particles[state.window.first + i];
  var o: Out;
  o.at = vec4f(2, 2, 2, 1);
  if (!(p.position.w < p.velocity.w)) { return o; }
  let toEye = normalize(draw.eye - p.position.xyz);
  let right = normalize(cross(select(vec3f(0, 1, 0), vec3f(1, 0, 0), abs(toEye.y) > 0.99), toEye));
  o.corner = vec2f(f32(v & 1u), f32(v >> 1u)) * 2 - 1;
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
@fragment fn fs(in: Out) -> Lit { let c = particle(in); return Lit(c, vec4f(0, 1, 0, c.a)); }
${DISPLAY_ROUTE_WGSL}${displayMaskWgsl(1)}
struct Routed { @location(0) color: vec4f, @location(1) tint: vec4f, @location(2) add: vec4f, @location(3) reactive: vec4f }
@fragment fn fsRouted(in: Out) -> Routed {
  let c = particle(in);
  let r = displayRoute(draw.color.rgb, draw.exposure, u32(draw.curve), draw.unlit != 0, c.a, maskAt(in.at));
  return Routed(c * r.keep, r.tint, r.add, vec4f(0, 1, 0, c.a));
}`
