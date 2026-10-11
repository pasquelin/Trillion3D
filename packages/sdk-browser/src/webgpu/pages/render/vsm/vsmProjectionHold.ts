// The projection's mask is a function of its inputs: the view and the projection it reconstructs
// the pixels with, the scene and resources the depth was drawn from, the lights and their channels,
// the shadow pages (their version, once settled) and the stochastic phase of the rays. A drawn
// frame whose inputs all equal those of the frame that wrote the mask rewrites the same mask: the
// projection is not run, and the mask the last one wrote is read again.
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from '../../../../vsm/projectionView.ts'

/** The words of a key: the view and the projection, the revisions and epochs, the sizes, the
 *  phase, the light count and the lights' first ids. */
const KEY_WORDS = 16 + 16 + 10 + VSM_PROJECTION_MAX_PASS_LIGHTS

/** What a projection was drawn from. */
export interface VsmProjectionInputs {
  view: ArrayLike<number>
  projection: ArrayLike<number>
  /** The gate's view, scene and resource revisions. */
  revisions: { view: number; scene: number; resources: number }
  /** The light store's epoch, and the shadow pages' version (`shadowEpoch`). */
  lightsEpoch: number
  shadowEpoch: number
  /** The stochastic phase (`stochasticPhase`). */
  phase: number
  /** The targets' allocated size. */
  size: readonly [number, number]
  /** The lights the pass reads, in channel order, each with its first map id. */
  lights: ArrayLike<{ mapId: number }>
}

/** The projection's last inputs: `held` answers whether the frame's `inputs` (rewritten in place
 *  each frame) equal them, `keep` takes them once the projection ran from them. */
export function createVsmProjectionHold() {
  const kept = new Float64Array(KEY_WORDS),
    next = new Float64Array(KEY_WORDS),
    inputs: VsmProjectionInputs = {
      view: kept,
      projection: kept,
      revisions: { view: 0, scene: 0, resources: 0 },
      lightsEpoch: 0,
      shadowEpoch: 0,
      phase: 0,
      size: [0, 0],
      lights: [],
    }
  let mask: object | undefined
  return {
    inputs,
    /** Whether `inputs`, read into the mask `target`, are what the last projection ran from. */
    held(target: object) {
      write(next, inputs)
      if (mask !== target) return false
      for (let k = 0; k < KEY_WORDS; k++) if (next[k] !== kept[k]) return false
      return true
    },
    /** The projection ran from the inputs of the last `held` question, into `target`. */
    keep(target: object) {
      kept.set(next)
      mask = target
    },
  }
}

function write(key: Float64Array, inputs: VsmProjectionInputs) {
  key.fill(0)
  for (let k = 0; k < 16; k++) {
    key[k] = inputs.view[k]
    key[16 + k] = inputs.projection[k]
  }
  const { revisions, size } = inputs
  key[32] = revisions.view
  key[33] = revisions.scene
  key[34] = revisions.resources
  key[35] = inputs.lightsEpoch
  key[36] = inputs.shadowEpoch
  key[37] = inputs.phase
  key[38] = size[0]
  key[39] = size[1]
  key[40] = inputs.lights.length
  for (let k = 0; k < inputs.lights.length; k++) key[41 + k] = inputs.lights[k].mapId
}
