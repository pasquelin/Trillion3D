// The projection's mask is a function of its inputs: the view and the projection it reconstructs
// the pixels with, the scene and resources the depth was drawn from, the lights and their channels,
// the shadow pages (their version, once settled) and the stochastic phase of the rays. A drawn
// frame whose inputs all equal those of the frame that wrote the mask rewrites the same mask: the
// projection is not run, and the mask the last one wrote is read again.
import { copyMatrix4 } from '../../../../../../math/src/matrix/matrix4.ts'
import { sameValues } from '../../../../../../math/src/matrix/matrixElements.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from '../../../../vsm/projectionView.ts'

/** The words of a key, in `write`'s order: the view and the projection, the three revisions, the
 *  two epochs, the phase, the two sizes, the light count and the lights' first ids. */
const KEY_WORDS = 16 + 16 + 9 + VSM_PROJECTION_MAX_PASS_LIGHTS

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
      view: new Float64Array(16),
      projection: new Float64Array(16),
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
      return mask === target && sameValues(next, kept)
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
  copyMatrix4(key, inputs.view, 0)
  copyMatrix4(key, inputs.projection, 16)
  const { revisions, size, lights } = inputs
  let at = 32
  key[at++] = revisions.view
  key[at++] = revisions.scene
  key[at++] = revisions.resources
  key[at++] = inputs.lightsEpoch
  key[at++] = inputs.shadowEpoch
  key[at++] = inputs.phase
  key[at++] = size[0]
  key[at++] = size[1]
  key[at++] = lights.length
  for (let k = 0; k < lights.length; k++) key[at++] = lights[k].mapId
}
