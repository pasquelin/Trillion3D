// How the scene trace's answers stand against the oracle's (`sceneTraceOracle.ts`): the kernel's answers
// decoded, and, ray by ray, the nearest hits and the shadow rays compared with the brute force over the same triangles.
import { NO_INDEX } from '../../../packages/math/src/constants.ts'
import { ANSWER_WORDS, type Casts } from './sceneTraceRays.ts'
import {
  distanceTolerance,
  type PlacedTriangles,
  traceBruteForce,
  type OracleRules,
  PLAIN_RULES,
} from './sceneTraceOracle.ts'

/** The answer of the kernel for one ray. */
interface Answer {
  distance: number
  placement: number
  triangle: number
  object: number
  hit: boolean
  complete: boolean
  front: boolean
}

/** The answers of the kernel for a batch of rays. */
export function decode(words: Uint32Array): Answer[] {
  const floats = new Float32Array(words.buffer)
  // Eight words a ray: the distance, the placement, the triangle and the flags, then the object and three zeros.
  return Array.from({ length: words.length / ANSWER_WORDS }, (_, i) => {
    const at = i * ANSWER_WORDS
    return {
      distance: floats[at],
      placement: words[at + 1],
      triangle: words[at + 2],
      object: words[at + 4],
      hit: (words[at + 3] & 1) !== 0,
      complete: (words[at + 3] & 2) !== 0,
      front: (words[at + 3] & 4) !== 0,
    }
  })
}

/** How the trace's nearest hits stand against the oracle's. */
export function compareNearest(
  placed: PlacedTriangles,
  casts: Casts,
  answers: Answer[],
  eye: ArrayLike<number>,
  rules: OracleRules = PLAIN_RULES,
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
    /** Hits that name another object than the oracle's, where the triangle is the same, hits on an HLOD actor's triangle,
     *  and those of them the oracle tells by a stand-in (its object is not `NO_INDEX`). */
    wrongObject: 0,
    actorHits: 0,
    standInHits: 0,
    /** Hits at the same distance as another triangle's: the trace may name either. */
    tied: 0,
    placementsMet: 0,
    /** The largest gap between the two distances, in tolerances (`distanceTolerance`). */
    worstGap: 0,
    problems: [] as string[],
  }
  const met = new Set<number>()
  answers.forEach((gpu, i) => {
    const cpu = traceBruteForce(placed, casts.oracle(i, eye, rules))
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
    else {
      if (cpu.actor) {
        out.actorHits++
        if (cpu.object !== NO_INDEX) out.standInHits++
      }
      if (gpu.object !== cpu.object) {
        out.wrongObject++
        out.problems.push(`ray ${i}: gpu object ${gpu.object}, oracle ${cpu.object}`)
      }
    }
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
      casts.oracle(i, eye, { anyHit: true, cullFront: true, shadow: true, skipTranslucent: true }),
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
