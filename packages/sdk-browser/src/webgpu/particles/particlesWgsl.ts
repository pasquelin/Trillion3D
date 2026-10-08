import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from '../blend/displayFilter.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL } from '../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { tangentBillboard } from '../../../../math/src/wgsl/basis.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PARTICLE_WORKGROUP, stepFoldWgsl } from './stepFoldWgsl.ts'
import { perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
import { DIVISOR_FLOOR } from '../../../../math/src/wgsl/constants.ts'

// The particle kernels: the step (`webgpuParticles.ts`) and the draw (`webgpuParticleDraw.ts`).

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
const STATE_WGSL = wgslBlock(
  'STATE_WGSL',
  [],
  `
struct Particle { position: vec4f, velocity: vec4f }
struct Window { vertices: u32, instances: u32, firstVertex: u32, firstInstance: u32, first: u32, pad0: u32, pad1: u32, pad2: u32 }
struct State { window: Window, particles: array<Particle> }`,
)

/** Bytes of a pool's window dispatch: its workgroups along x, its rows of them along y past one
 *  dimension's (`groupGrid`), then 1, written by `bound`. */
export const PARTICLE_ARGS_BYTES = 12

/** The workgroups covering `slots` slots. */
export const particleGroups = (slots: number) => ceilDiv(slots, PARTICLE_WORKGROUP)

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
export const particlesWgsl = (subgroups: boolean) =>
  wgslProgram(
    /* wgsl */ `${subgroups ? 'enable subgroups;' : ''}
struct Step { acceleration: vec3f, dt: f32, first: u32, count: u32, capacity: u32, groups: u32 }
@group(0) @binding(0) var<uniform> step: Step;
@group(0) @binding(1) var<storage, read> staged: array<Particle>;
@group(0) @binding(2) var<storage, read_write> state: State;
@group(0) @binding(3) var<storage, read_write> partials: array<vec2u>;
@group(0) @binding(4) var<storage, read_write> args: array<u32>;
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
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) local: u32, @builtin(num_workgroups) n: vec3u) {
  let k = flatIndex(id, n, ${PARTICLE_WORKGROUP}u);
  let i = state.window.first + k;
  let span = foldStep(local, spanOf(i, k < state.window.instances && stepSlot(i)));
  // A group of the last row past the window, its first lane past it, writes no partial.
  if (local == 0u && k < state.window.instances) { partials[flatIndex(wg, n, 1u)] = span; }
}
@compute @workgroup_size(${PARTICLE_WORKGROUP})
fn emit(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) local: u32, @builtin(num_workgroups) n: vec3u) {
  let k = flatIndex(id, n, ${PARTICLE_WORKGROUP}u);
  let j = step.first + k;
  let i = select(j, j - step.capacity, j >= step.capacity);
  let span = foldStep(local, spanOf(i, k < step.count && stepSlot(i)));
  // A group of the last row past the records, its first lane past the count, writes no partial.
  if (local == 0u && k < step.count) { partials[windowGroups() + flatIndex(wg, n, 1u)] = span; }
}
@compute @workgroup_size(${PARTICLE_WORKGROUP})
fn bound(@builtin(local_invocation_index) local: u32) {
  var span = vec2u(0u);
  // The window's workgroups \`main\` stepped: its rows' padding wrote no partial.
  let stepped = (state.window.instances + ${PARTICLE_WORKGROUP - 1}u) / ${PARTICLE_WORKGROUP}u;
  for (var g = local; g < stepped; g += ${PARTICLE_WORKGROUP}u) { span = max(span, partials[g]); }
  for (var g = local; g < step.groups; g += ${PARTICLE_WORKGROUP}u) { span = max(span, partials[windowGroups() + g]); }
  span = foldStep(local, span);
  if (local == 0u) {
    let first = select(0u, ~span.x, span.y != 0u);
    state.window.first = first;
    state.window.instances = span.y - first;
    let grid = groupGrid((span.y - first + ${PARTICLE_WORKGROUP - 1}u) / ${PARTICLE_WORKGROUP}u);
    args[0] = grid.x;
    args[1] = grid.y;
  }
}`,
    [STATE_WGSL, stepFoldWgsl(subgroups), FLAT_INDEX_WGSL, GROUP_GRID_WGSL],
  )

/** Per slot of the step's window, a disc facing the eye, fading with age, at its edge and near
 *  the scene's depth; one module, two fragment entries. `fs`: its coverage is the reactive value
 *  (#833), so the temporal pass keeps no trail of it. `fsRouted`, an image with display layers
 *  (`../blend/displayFilter.ts`): where the mask is set, the disc maps the tint and the added
 *  value by its display colour, not the lit image. */
export const PARTICLE_DRAW_WGSL = wgslProgram(
  /* wgsl */ `struct Draw { clip: mat4x4f, unclip: mat4x4f, eye: vec3f, size: f32, color: vec4f, softness: f32, exposure: f32, curve: f32, unlit: f32, drawn: vec2f }
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
  let right = tangentBillboard(toEye);
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
  let behind = distance(perspectiveDivide(scene), draw.eye) - distance(in.local, draw.eye);
  let soft = select(1.0, saturate(behind / draw.softness), abs(scene.w) > DIVISOR_FLOOR);
  let k = saturate(1 - dot(in.corner, in.corner)) * soft * in.life * draw.color.a;
  return vec4f(draw.color.rgb, 1) * k;
}
struct Lit { @location(0) color: vec4f, @location(1) reactive: vec4f }
@fragment fn fs(in: Out) -> Lit { let c = particle(in); return Lit(c, vec4f(0, 1, 0, c.a)); }
struct Routed { @location(0) color: vec4f, @location(1) tint: vec4f, @location(2) add: vec4f, @location(3) reactive: vec4f }
@fragment fn fsRouted(in: Out) -> Routed {
  let c = particle(in);
  let r = displayRoute(draw.color.rgb, draw.exposure, u32(draw.curve), draw.unlit != 0, c.a, maskAt(in.at));
  return Routed(c * r.keep, r.tint, r.add, vec4f(0, 1, 0, c.a));
}`,
  [
    STATE_WGSL,
    DISPLAY_ROUTE_WGSL,
    displayMaskWgsl(1),
    tangentBillboard,
    perspectiveDivide,
    DIVISOR_FLOOR,
  ],
)
