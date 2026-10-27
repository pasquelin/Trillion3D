// The scene trace's rays and their oracle: the kernel that casts them on the GPU (a ray in, its hit
// out, a thread each), the 4096 nearest-hit rays and the 4096 shadow rays of the proof, and how the
// answers stand against the brute force over the same triangles (`sceneTraceOracle.ts`).
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { mulberry32 } from '../../../packages/math/src/sequence/random.ts'
import { perspectiveSlope } from '../../../packages/math/src/projection/camera.ts'
import { TAU } from '../../../packages/math/src/constants.ts'
import { cross, subtract, unit, type Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'
import {
  sceneTraceLayoutEntries,
  sceneTraceWgsl,
} from '../../../packages/sdk-browser/src/lighting/rays/sceneTrace/sceneTraceWgsl.ts'
import { GROUND_HALF } from './sceneTraceScene.ts'
import { POSE, SIZE } from './traceWorld.ts'
import {
  distanceTolerance,
  type PlacedTriangles,
  traceBruteForce,
  type OracleRay,
} from './sceneTraceOracle.ts'

export const RAYS = 4096
/** The share of the rays that may graze an edge. */
export const GRAZING = 0.005

/** The shadow rays' direction: toward the sun, above the ground. */
const SUN = unit([0.4, 0.8, 0.3])
/** How far a shadow ray reaches, in metres, and how far above the ground it starts. */
const SHADOW_REACH = 100,
  LIFT = 1e-3

/** The bindings the library takes in its group from 0; the rays and the answers follow them. */
export const RAYS_BINDING = sceneTraceLayoutEntries(0).length

/** The trace's compute program: a ray in, its hit out, a thread each. The library is in group 1
 *  from binding 0, the cut's tables in group 0; the rays and the answers follow it. */
const GROUP = 1
export const KERNEL = wgslProgram(
  `@group(${GROUP}) @binding(${RAYS_BINDING}) var<storage,read> casts:array<vec4f>;
@group(${GROUP}) @binding(${RAYS_BINDING + 1}) var<storage,read_write> answers:array<vec4u>;
@compute @workgroup_size(64) fn traceRays(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=arrayLength(&answers)){return;}
 let a=casts[3u*i];
 let b=casts[3u*i+1u];
 let c=casts[3u*i+2u];
 let hit=stTrace(StRay(a.xyz,b.xyz,a.w,b.w,bitcast<u32>(c.x)));
 answers[i]=vec4u(bitcast<u32>(hit.distance),hit.placement,hit.triangle,u32(hit.hit)|(u32(stComplete)<<1u)|(u32(hit.frontFace)<<2u));
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
  oracle(
    i: number,
    eye: ArrayLike<number>,
    rules: Omit<OracleRay, 'origin' | 'direction' | 'tMax'>,
  ): OracleRay {
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

/** The nearest-hit rays: a 64 × 48 fan through the view from points of a 4 × 4 × 4 grid within a
 *  metre and a half of the eye, then the rest in all directions, drawn from a fixed seed. */
export function nearestRays(casts: Casts) {
  const forward = unit(subtract(POSE.target, POSE.position)),
    right = unit(cross(forward, [0, 1, 0])),
    up = cross(right, forward)
  const slope = perspectiveSlope(POSE.fov),
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

/** The ray flags, written as literals to pin their ABI on purpose: any-hit 1, cull-front 2, shadow 4. */
const ANY_HIT = 1,
  CULL_FRONT = 2,
  SHADOW = 4

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
      ANY_HIT | CULL_FRONT | SHADOW,
    )
  }
}

/** The answer of the kernel for one ray. */
interface Answer {
  distance: number
  placement: number
  triangle: number
  hit: boolean
  complete: boolean
  front: boolean
}

/** The answers of the kernel for a batch of rays. */
export function decode(words: Uint32Array): Answer[] {
  const floats = new Float32Array(words.buffer)
  return Array.from({ length: words.length / 4 }, (_, i) => ({
    distance: floats[i * 4],
    placement: words[i * 4 + 1],
    triangle: words[i * 4 + 2],
    hit: (words[i * 4 + 3] & 1) !== 0,
    complete: (words[i * 4 + 3] & 2) !== 0,
    front: (words[i * 4 + 3] & 4) !== 0,
  }))
}

/** How the trace's nearest hits stand against the oracle's. */
export function compareNearest(
  placed: PlacedTriangles,
  casts: Casts,
  answers: Answer[],
  eye: ArrayLike<number>,
) {
  const out = {
    triangles: placed.count,
    hits: 0,
    misses: 0,
    grazing: 0,
    incomplete: 0,
    /** Rays on which the trace and the oracle part on hit or miss, or on the distance. */
    wrongHit: 0,
    /** Hits on another triangle or another face than the oracle's, where no second triangle is as near. */
    wrongTriangle: 0,
    wrongFace: 0,
    /** Hits at the same distance as another triangle's: the trace may name either. */
    tied: 0,
    placementsMet: 0,
    /** The largest gap between the two distances, in tolerances (`distanceTolerance`). */
    worstGap: 0,
    problems: [] as string[],
  }
  const met = new Set<number>()
  answers.forEach((gpu, i) => {
    const cpu = traceBruteForce(
      placed,
      casts.oracle(i, eye, { anyHit: false, cullFront: false, shadow: false }),
    )
    if (!gpu.complete) out.incomplete++
    if (!cpu.robust) return void out.grazing++
    if (gpu.hit !== cpu.hit) {
      out.wrongHit++
      return void out.problems.push(
        `ray ${i}: gpu ${gpu.hit ? `hit at ${gpu.distance}` : 'miss'}, oracle ${cpu.hit ? `hit at ${cpu.t}` : 'miss'}`,
      )
    }
    if (!cpu.hit) return void out.misses++
    out.hits++
    met.add(cpu.placement)
    const gap = Math.abs(gpu.distance - cpu.t) / distanceTolerance(cpu.t)
    out.worstGap = Math.max(out.worstGap, gap)
    if (gap > 1) out.problems.push(`ray ${i}: distance gpu ${gpu.distance}, oracle ${cpu.t}`)
    if (cpu.tie) return void out.tied++
    if (gpu.placement !== cpu.placement || gpu.triangle !== cpu.triangle) {
      out.wrongTriangle++
      out.problems.push(
        `ray ${i}: gpu placement ${gpu.placement} triangle ${gpu.triangle}, oracle ${cpu.placement}/${cpu.triangle}`,
      )
    } else if (gpu.front !== cpu.front) out.wrongFace++
  })
  out.placementsMet = met.size
  out.problems.length = Math.min(out.problems.length, 8)
  return out
}

/** How the trace's shadow rays stand against the oracle's: blocked, by a hit or by a trace that
 *  ended before it could say. */
export function compareShadow(
  placed: PlacedTriangles,
  casts: Casts,
  answers: Answer[],
  eye: ArrayLike<number>,
) {
  const out = { blocked: 0, open: 0, grazing: 0, incomplete: 0, wrong: 0, problems: [] as string[] }
  answers.forEach((gpu, i) => {
    const cpu = traceBruteForce(
      placed,
      casts.oracle(i, eye, { anyHit: true, cullFront: true, shadow: true }),
    )
    if (!gpu.complete) out.incomplete++
    if (!cpu.robust) return void out.grazing++
    const blocked = gpu.hit || !gpu.complete
    if (blocked !== cpu.hit) {
      out.wrong++
      return void out.problems.push(
        `ray ${i}: gpu ${blocked ? 'blocked' : 'open'}, oracle ${cpu.hit ? 'blocked' : 'open'}`,
      )
    }
    out[blocked ? 'blocked' : 'open']++
  })
  out.problems.length = Math.min(out.problems.length, 8)
  return out
}
