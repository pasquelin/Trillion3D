// The scene trace's rays: the kernel that casts them on the GPU (a ray in, its hit out, a thread
// each) and the 4096 rays of each batch of the proof; how the answers stand against the brute force
// over the same triangles (`sceneTraceOracle.ts`) is in `sceneTraceCompare.ts`.
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { mulberry32 } from '../../../packages/math/src/sequence/random.ts'
import { perspectiveSlope } from '../../../packages/math/src/projection/camera.ts'
import { TAU } from '../../../packages/math/src/constants.ts'
import { cross, subtract, unit, type Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'
import type { CameraPose } from '../../../packages/sdk-core/src/contracts/base.ts'
import {
  sceneTraceLayoutEntries,
  sceneTraceWgsl,
} from '../../../packages/sdk-browser/src/lighting/rays/sceneTrace/sceneTraceWgsl.ts'
import { GROUND_HALF } from './sceneTraceScene.ts'
import { POSE, SIZE } from './traceWorld.ts'
import {
  type PlacedTriangles,
  traceBruteForce,
  type OracleRay,
  type OracleRules,
  PLAIN_RULES,
} from './sceneTraceOracle.ts'

export const RAYS = 4096
/** The words of a ray's answer in the kernel's buffer: two `vec4u`. */
export const ANSWER_WORDS = 8
/** The share of the rays that may graze an edge. */
export const GRAZING = 0.005

/** The shadow rays' direction: toward the sun, above the ground. */
const SUN = unit([0.4, 0.8, 0.3])
/** How far a shadow ray reaches, in metres, and how far above the ground it starts. */
const SHADOW_REACH = 100,
  LIFT = 1e-3

/** The bindings the library takes in its group from 0; the rays and the answers follow them. */
export const RAYS_BINDING = sceneTraceLayoutEntries(0).length

/** The trace's compute program: a ray in, its hit out (two `vec4u`: the distance, the placement, the triangle and the
 *  flags, then the object), a thread each. The library is in group 1
 *  from binding 0, the cut's tables in group 0; the rays and the answers follow it. */
const GROUP = 1
export const KERNEL = wgslProgram(
  `@group(${GROUP}) @binding(${RAYS_BINDING}) var<storage,read> casts:array<vec4f>;
@group(${GROUP}) @binding(${RAYS_BINDING + 1}) var<storage,read_write> answers:array<vec4u>;
@compute @workgroup_size(64) fn traceRays(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(2u*i>=arrayLength(&answers)){return;}
 let a=casts[3u*i];
 let b=casts[3u*i+1u];
 let c=casts[3u*i+2u];
 let hit=stTrace(StRay(a.xyz,b.xyz,a.w,b.w,bitcast<u32>(c.x)));
 answers[2u*i]=vec4u(bitcast<u32>(hit.distance),hit.placement,hit.triangle,u32(hit.hit)|(u32(stComplete)<<1u)|(u32(hit.frontFace)<<2u));
 answers[2u*i+1u]=vec4u(hit.object,0u,0u,0u);
}`,
  [sceneTraceWgsl(GROUP, 0)],
)

/** The rays as the kernel reads them: three `vec4f` each, the origin from the eye and its nearest
 *  distance, the unit direction and its reach, the flags (a word). */
export class Casts {
  readonly floats = new Float32Array(RAYS * 12)
  readonly words = new Uint32Array(this.floats.buffer)
  set(
    i: number,
    origin: ArrayLike<number>,
    direction: ArrayLike<number>,
    reach: number,
    flags: number,
  ) {
    this.floats.set(
      [origin[0], origin[1], origin[2], 0, direction[0], direction[1], direction[2], reach],
      i * 12,
    )
    this.words[i * 12 + 8] = flags
  }
  /** The oracle's ray `i` from the eye: what the GPU holds, the float32 rounding included. */
  oracle(i: number, eye: ArrayLike<number>, rules: OracleRules): OracleRay {
    const f = this.floats,
      at = i * 12
    return {
      origin: [eye[0] + f[at], eye[1] + f[at + 1], eye[2] + f[at + 2]],
      direction: [f[at + 4], f[at + 5], f[at + 6]],
      tMax: f[at + 7],
      ...rules,
    }
  }
}

/** The nearest-hit rays: a 64 × 48 fan through the view `pose` from points of a 4 × 4 × 4 grid within a
 *  metre and a half of the eye, then the rest in all directions, drawn from a fixed seed. */
export function nearestRays(casts: Casts, pose: CameraPose = POSE) {
  const forward = unit(subtract(pose.target, pose.position)),
    right = unit(cross(forward, [0, 1, 0])),
    up = cross(right, forward)
  const slope = perspectiveSlope(pose.fov),
    aspect = SIZE[0] / SIZE[1]
  const draw = mulberry32(0x5eed)
  const grid = (k: number) => [(k & 3) - 1.5, ((k >> 2) & 3) - 1.5, ((k >> 4) & 3) - 1.5]
  const fan = 64 * 48
  for (let i = 0; i < RAYS; i++) {
    let direction: Vec3
    if (i < fan) {
      const x = ((i % 64) + 0.5) / 64,
        y = (Math.floor(i / 64) + 0.5) / 48
      direction = unit(
        forward.map(
          (f, a) => f + (2 * x - 1) * slope * aspect * right[a] + (1 - 2 * y) * slope * up[a],
        ) as Vec3,
      )
    } else {
      const z = 2 * draw() - 1,
        phi = TAU * draw(),
        ring = Math.sqrt(1 - z * z)
      direction = [ring * Math.cos(phi), z, ring * Math.sin(phi)]
    }
    casts.set(i, grid((i * 13) % 64), direction, 1000, 0)
  }
}

/** The rays aimed at the HLOD actors' triangles: each from the eye to a point of a triangle drawn from a fixed seed among
 *  the actors' (a point inside it, off every edge), so that every one would meet an actor
 *  were nothing nearer in its way. */
export function actorRays(casts: Casts, placed: PlacedTriangles, eye: ArrayLike<number>) {
  const actors = Array.from({ length: placed.count }, (_, i) => i).filter((i) => placed.actor[i])
  if (!actors.length) throw new Error('the cut draws no HLOD actor: no ray can be aimed at one')
  const draw = mulberry32(0xac70)
  for (let i = 0; i < RAYS; i++) {
    const at = actors[Math.floor(draw() * actors.length)] * 9
    // Three weights of a tenth to one, normalised: the point lies a few hundredths of the triangle from every edge.
    const w = [0, 0, 0].map(() => 0.1 + 0.9 * draw())
    const sum = w[0] + w[1] + w[2]
    const target = [0, 1, 2].map(
      (axis) =>
        (w[0] * placed.exact[at + axis] +
          w[1] * placed.exact[at + 3 + axis] +
          w[2] * placed.exact[at + 6 + axis]) /
        sum,
    )
    const direction = unit(target.map((v, axis) => v - eye[axis]) as Vec3)
    casts.set(i, [0, 0, 0], direction, 2000, 0)
  }
}

/** The rays that leave the surfaces the rays of `view` met: each from a centimetre past its hit, on along it, as a
 *  texel's ray leaves its surface — within a closed primitive they meet its back faces first; a ray of `view` that met
 *  nothing starts where it did. `flags` their rules. */
export function surfaceRays(
  casts: Casts,
  view: Casts,
  placed: PlacedTriangles,
  eye: ArrayLike<number>,
  flags: number,
) {
  for (let i = 0; i < RAYS; i++) {
    const ray = view.oracle(i, eye, PLAIN_RULES)
    const met = traceBruteForce(placed, ray)
    const past = met.hit ? met.t + 0.01 : 0
    casts.set(
      i,
      [0, 1, 2].map((a) => ray.origin[a] + ray.direction[a] * past - eye[a]),
      ray.direction,
      ray.tMax,
      flags,
    )
  }
}

/** The ray flags, written as literals to pin their ABI on purpose: any-hit 1, cull-front 2, shadow 4, cull-back 8,
 *  skip-translucent 16, skip-near 32. */
const ANY_HIT = 1,
  CULL_FRONT = 2,
  SHADOW = 4
export const CULL_BACK = 8,
  SKIP_TRANSLUCENT = 16,
  SKIP_NEAR = 32

/** The shadow rays: from points of the ground drawn from a fixed seed, a hair above it, toward the
 *  sun; the first hit, the front faces culled, the shadow rules. */
export function shadowRays(casts: Casts, eye: ArrayLike<number>) {
  const draw = mulberry32(0xd0d0)
  const span = GROUND_HALF - 6
  for (let i = 0; i < RAYS; i++) {
    const point = [(2 * draw() - 1) * span, LIFT, (2 * draw() - 1) * span]
    casts.set(
      i,
      point.map((v, a) => v - eye[a]),
      SUN,
      SHADOW_REACH,
      ANY_HIT | CULL_FRONT | SHADOW | SKIP_TRANSLUCENT,
    )
  }
}
