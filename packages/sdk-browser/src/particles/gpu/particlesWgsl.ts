import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from '../../blend/display/displayFilter.ts'
import {
  FLAT_INDEX_WGSL,
  GROUP_GRID_WGSL,
  WORKGROUP_THREADS_WGSL,
  WORKGROUP_THREADS,
} from '../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { stepFoldWgsl } from './stepFoldWgsl.ts'
import { drawStruct } from '../drawWords.ts'
import {
  perspectiveDivide,
  pixelToNdc,
  transformHomogeneousPoint,
} from '../../../../math/src/wgsl/projection.ts'
import { unitToSigned2 } from '../../../../math/src/wgsl/reals.ts'
import { DIVISOR_FLOOR } from '../../../../math/src/wgsl/constants.ts'
import { preExposedWgsl } from '../../post/exposure/preWgsl.ts'
import {
  clipDirective,
  clippedStructText,
  clipReturn,
  clipReturnType,
  cutByPixel,
  type Clipping,
} from '../../gpu/core/clipDistances.ts'
import { planeDistance } from '../../../../math/src/wgsl/geometry.ts'

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
struct Particle { position: vec4f, velocity: vec4f, shape: vec4f, color: vec4f }
struct Window { vertices: u32, instances: u32, firstVertex: u32, firstInstance: u32, first: u32, pad0: u32, pad1: u32, pad2: u32 }
struct State { window: Window, particles: array<Particle> }`,
)

/** Bytes of a pool's window dispatch: its workgroups along x, its rows of them along y past one
 *  dimension's (`groupGrid`), then 1, written by `bound`. */
export const PARTICLE_ARGS_BYTES = 12

/** The workgroups covering `slots` slots. */
export const particleGroups = (slots: number) => ceilDiv(slots, WORKGROUP_THREADS)

/** The step's uniform and bindings, and the slot it moves: `stepSlot`, `spanOf`, `windowGroups`. */
const STEP_SLOT_TEXT = /* wgsl */ `struct Step { acceleration: vec3f, dt: f32, first: u32, count: u32, capacity: u32, groups: u32 }
@group(0) @binding(0) var<uniform> step: Step;
@group(0) @binding(1) var<storage, read> staged: array<Particle>;
@group(0) @binding(2) var<storage, read_write> state: State;
@group(0) @binding(3) var<storage, read_write> partials: array<vec2u>;
@group(0) @binding(4) var<storage, read_write> args: array<u32>;
fn stepSlot(i: u32) -> bool {
  let d = i - step.first;
  let k = select(d, d + step.capacity, i < step.first);
  if (k < step.count) { state.particles[i] = staged[k]; }
  var position = state.particles[i].position;
  var velocity = state.particles[i].velocity;
  if (!(position.w < velocity.w)) { return false; }
  let gain = step.acceleration * step.dt;
  position = vec4f(position.xyz + (velocity.xyz + 0.5 * gain) * step.dt, position.w + step.dt);
  velocity = vec4f(velocity.xyz + gain, velocity.w);
  state.particles[i].position = position;
  state.particles[i].velocity = velocity;
  return position.w < velocity.w;
}
fn spanOf(i: u32, alive: bool) -> vec2u { return select(vec2u(0u), vec2u(~i, i + 1u), alive); }
fn windowGroups() -> u32 { return (step.capacity + (WORKGROUP_THREADS-1u)) / WORKGROUP_THREADS; }`

/** The step of the live window (`main`) and of the records (`emit`), each folding its slots' span. */
const STEP_ENTRIES_TEXT = /* wgsl */ `@compute @workgroup_size(WORKGROUP_THREADS)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) local: u32, @builtin(num_workgroups) n: vec3u) {
  let k = flatIndex(id, n, WORKGROUP_THREADS);
  let i = state.window.first + k;
  let span = foldStep(local, spanOf(i, k < state.window.instances && stepSlot(i)));
  // A group of the last row past the window, its first lane past it, writes no partial.
  if (local == 0u && k < state.window.instances) { partials[flatIndex(wg, n, 1u)] = span; }
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn emit(@builtin(global_invocation_id) id: vec3u, @builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) local: u32, @builtin(num_workgroups) n: vec3u) {
  let k = flatIndex(id, n, WORKGROUP_THREADS);
  let j = step.first + k;
  let i = select(j, j - step.capacity, j >= step.capacity);
  let span = foldStep(local, spanOf(i, k < step.count && stepSlot(i)));
  // A group of the last row past the records, its first lane past the count, writes no partial.
  if (local == 0u && k < step.count) { partials[windowGroups() + flatIndex(wg, n, 1u)] = span; }
}`

/** `bound`: folds the partials both dispatches wrote into the window and the draw's arguments. */
const STEP_BOUND_TEXT = /* wgsl */ `@compute @workgroup_size(WORKGROUP_THREADS)
fn bound(@builtin(local_invocation_index) local: u32) {
  var span = vec2u(0u);
  // The window's workgroups \`main\` stepped: its rows' padding wrote no partial.
  let stepped = (state.window.instances + (WORKGROUP_THREADS-1u)) / WORKGROUP_THREADS;
  for (var g = local; g < stepped; g += WORKGROUP_THREADS) { span = max(span, partials[g]); }
  for (var g = local; g < step.groups; g += WORKGROUP_THREADS) { span = max(span, partials[windowGroups() + g]); }
  span = foldStep(local, span);
  if (local == 0u) {
    let first = select(0u, ~span.x, span.y != 0u);
    state.window.first = first;
    state.window.instances = span.y - first;
    let grid = groupGrid((span.y - first + (WORKGROUP_THREADS-1u)) / WORKGROUP_THREADS);
    args[0] = grid.x;
    args[1] = grid.y;
  }
}`

/** One invocation per slot that can change: `main` over the window of the slots alive after the
 *  last step, its workgroups the dispatch `bound` wrote; `emit` over the ring's records of this
 *  image, `[first, first + count)` around the capacity. A slot is replaced by its record when the
 *  ring holds one — so a slot both cover ends the same —, then a live particle moves (position
 *  from the pool's origin), its position and velocity alone stored: its size, rotation and colour
 *  are written once, at birth; a dead one nobody emitted into is left as it is, and a slot outside
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
${STEP_SLOT_TEXT}
${STEP_ENTRIES_TEXT}
${STEP_BOUND_TEXT}`,
    [STATE_WGSL, stepFoldWgsl(subgroups), FLAT_INDEX_WGSL, GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL],
  )

/** Per slot of the step's window, a disc across the view, its colour changing with age, soft at its
 *  edge and where it nears the scene's depth along the view; one module, two fragment entries.
 *  `fs` writes the lit colour. `fsRouted`, an image with display layers
 *  (`../../blend/display/displayFilter.ts`): where the mask is set, the disc maps the tint and the added
 *  value by its display colour, not the lit image. */
const particleDrawWgsl = (clipping?: Clipping) =>
  wgslProgram(
    /* wgsl */ `@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var<storage, read> state: State;
@group(0) @binding(2) var depth: texture_depth_2d;
struct Out { ${PARTICLE_OUT.join(', ')} }${clipping === 'distance' ? `\n${clippedStructText('Out', PARTICLE_OUT)}` : ''}
@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> ${clipReturnType('Out', clipping)} {
  let p = state.particles[state.window.first + i];
  var o: Out;
  o.at = vec4f(2, 2, 2, 1);
  if (!(p.position.w < p.velocity.w)) { return ${clipReturn('Out', clipping, 'o', '1.0')}; }
  o.corner = unitToSigned2(vec2f(f32(v & 1u), f32(v >> 1u)));
  let side = o.corner * p.shape.xy;
  let turn = vec2f(cos(p.shape.z), sin(p.shape.z));
  o.local = p.position.xyz + draw.right * (side.x * turn.x + side.y * turn.y) + draw.up * (side.y * turn.x - side.x * turn.y);
  o.at = draw.clip * vec4f(o.local, 1);
  o.color = p.color * mix(vec4f(1), draw.ending, p.position.w / p.velocity.w);
  return ${clipReturn('Out', clipping, 'o', 'planeDistance(draw.clipPlane, o.local)')};
}
fn coverage(in: Out) -> f32 {
  let ndc = pixelToNdc(in.at.xy, draw.drawn);
  let scene = transformHomogeneousPoint(draw.unclip, vec3f(ndc, textureLoad(depth, vec2i(in.at.xy), 0)));
  let behind = dot(perspectiveDivide(scene) - in.local, draw.forward);
  let soft = select(1.0, saturate(behind / draw.softness), abs(scene.w) > DIVISOR_FLOOR);
  return saturate(1 - dot(in.corner, in.corner)) * soft * in.color.a;
}
fn particle(in: Out) -> vec4f {
  return vec4f(preExposedClipped(in.color.rgb), 1) * coverage(in);
}
${clipping === 'pixel' ? 'fn particleClipped(in: Out) -> bool { return planeDistance(draw.clipPlane, in.local) < 0.0; }\n' : ''}@fragment fn fs(in: Out) -> @location(0) vec4f { return particle(in); }
// The alpha holdout's accumulation of a premultiplied pool (\`../../blend/holdout.ts\`), drawn where the alpha holdout is not in effect: it lets \`1 − coverage\` of the path through.
@fragment fn fsHoldout(in: Out) -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0 - coverage(in)); }
struct Routed { @location(0) color: vec4f, @location(1) tint: vec4f, @location(2) add: vec4f }
@fragment fn fsRouted(in: Out) -> Routed {
  let c = particle(in);
  let r = displayRoute(preExposedClipped(in.color.rgb), draw.exposure, u32(draw.curve), draw.unlit != 0, c.a, maskAt(in.at), draw.bake);
  return Routed(c * r.keep, r.tint, r.add);
}`,
    [
      drawStruct(!!clipping),
      STATE_WGSL,
      preExposedWgsl('draw.preExposure'),
      DISPLAY_ROUTE_WGSL,
      displayMaskWgsl(1),
      perspectiveDivide,
      transformHomogeneousPoint,
      DIVISOR_FLOOR,
      pixelToNdc,
      unitToSigned2,
      ...clipDirective(clipping),
      ...(clipping ? [planeDistance] : []),
    ],
  )

/** The members of the draw's vertex output, as the struct both stages share (`Out`). */
const PARTICLE_OUT = [
  '@builtin(position) at: vec4f',
  '@location(0) corner: vec2f',
  '@location(1) local: vec3f',
  '@location(2) color: vec4f',
]

/** The draw's module of a view with no plane: nothing of the cut at it in the text. */
export const PARTICLE_DRAW_WGSL = particleDrawWgsl()

/** The draw's module made to cut at the view's plane (`Clipping`): by the vertex stage's clip
 *  distance, or, each fragment entry leaving a pixel behind the plane (`particleClipped`); none
 *  without `clipping`, `PARTICLE_DRAW_WGSL`. */
export const particleDrawShader = (clipping?: Clipping) =>
  clipping
    ? cutByPixel(
        particleDrawWgsl(clipping),
        'Out',
        'if (particleClipped(in)) { discard; }',
        clipping,
      )
    : PARTICLE_DRAW_WGSL
