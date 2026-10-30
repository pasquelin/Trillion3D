// The projection's mask is a function of its inputs: the view and the projection it reconstructs
// the pixels with, the scene and resources the depth was drawn from, the lights and their channels,
// the shadow pages (their version, once settled), the rays and steps of the traces and the stochastic phase of the rays. A drawn
// frame whose inputs all equal those of the frame that wrote the mask rewrites the same mask: the
// projection is not run, and the mask the last one wrote is read again.
import { copyMatrix4 } from '../../../../../../math/src/matrix/matrix4.ts'
import { sameValues } from '../../../../../../math/src/matrix/matrixElements.ts'
import {
  VSM_PROJECTION_MAX_PASS_LIGHTS,
  type VsmTraceCounts,
} from '../projection/projectionView.ts'
import { SHADOW_RAY_COUNT_MAX } from '../../../../../../sdk-core/src/contracts/shadowMapOptions.ts'

/** The words of the distance-field cascade's inputs in a key. */
const FIELD_WORDS = 7

/** The words of a key, in `write`'s order: the view and the projection, the three revisions, the
 *  two epochs, the phase, the trace key, the two sizes, the light count, the light grid's two sizes
 *  and whether the depth pyramid cut it, the back-face cull, the distance-field cascade's inputs (`field`), the key of the shadows laid into the masks beside the projection (`contributors`), the passes of the masks' denoise (`denoise`) and the lights' first ids. */
const KEY_WORDS = 16 + 16 + 15 + FIELD_WORDS + 2 + VSM_PROJECTION_MAX_PASS_LIGHTS

/** The radix of a light's first id in its key word, over any map id. */
const MAP_RADIX = 2 ** 24

/** The values a ray count takes: 0 to `SHADOW_RAY_COUNT_MAX`. */
const RAY_DIGITS = SHADOW_RAY_COUNT_MAX + 1

/** The rays and steps of a view's traces as one number, each count a digit of its own (rays 0 to
 *  `SHADOW_RAY_COUNT_MAX`, steps 0 to 64): a mask differs where they do. */
export const vsmTraceKey = (counts: VsmTraceCounts) =>
  counts.shadowRayCountDirectional +
  RAY_DIGITS *
    (counts.shadowRayCountLocal +
      RAY_DIGITS * (counts.shadowSamplesPerRayDirectional + 65 * counts.shadowSamplesPerRayLocal))

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
  /** The rays and steps of the traces (`vsmTraceKey`). */
  trace: number
  /** The targets' allocated size. */
  size: readonly [number, number]
  /** The most local lights a pixel's mask keeps (`shadowOnePassProjectionMaxLightsPerPixel`). */
  maxLights: number
  /** The lights the pass reads, in channel order, each with its first map id. */
  lights: ArrayLike<{ mapId: number; firstPersonMapId?: number }>
  /** The light grid's view cells and the words of its view part (`VsmProjectionSource`): the shadowed
   *  lights' grid is laid out over them. */
  gridCells: number
  gridWords: number
  /** Whether the depth pyramid cut the light grid's lists this image (`lightGridCulled`): the mask's
   *  lanes follow the lists, and the marking prunes the grid again every image. */
  gridCulled: boolean
  /** Whether the pixels facing away from a light are culled (`shadowCullBackfacingPixels`). */
  cullBackfacing: boolean
  /** The key of the shadows laid into the masks beside the projection (`MaskContributor.holdKey`, 0 for none): a contributor that comes, goes or changes what it adds changes the masks. */
  contributors: number
  /** The passes of the masks' denoise (`shadowDenoise`, `shadowDenoiseIterations`; 0 for none): the mask holds its result, so another count is another mask. */
  denoise: number
  /** What the classic suns' distance-field cascade is laid from, which the mask holds: the generation of the meshes' fields, their revision (placements and bricks changing) and the settings of the cascade. */
  field: {
    generation: number
    revision: number
    shadowing: boolean
    quality: number
    fullResolution: boolean
    distanceScale: number
    farTransitionScale: number
  }
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
      trace: 0,
      size: [0, 0],
      maxLights: 0,
      lights: [],
      gridCells: 0,
      gridWords: 0,
      gridCulled: false,
      cullBackfacing: true,
      contributors: 0,
      denoise: 0,
      field: {
        generation: 0,
        revision: 0,
        shadowing: false,
        quality: 0,
        fullResolution: false,
        distanceScale: 1,
        farTransitionScale: 1,
      },
    }
  // What the pass writes and reads its layout from: the last asked (`next`) and the kept ones.
  const asked: (object | undefined)[] = [undefined, undefined, undefined, undefined],
    masks: (object | undefined)[] = [undefined, undefined, undefined, undefined]
  return {
    inputs,
    /** Whether `inputs`, read into the masks `suns` and `locals` and the shadowed lights' grid `grid`
     *  over the light grid `tiles`, are what the last projection ran from. */
    held(suns: object, locals?: object, tiles?: object, grid?: object) {
      write(next, inputs)
      asked[0] = suns
      asked[1] = locals
      asked[2] = tiles
      asked[3] = grid
      return sameMasks(masks, asked) && sameValues(next, kept)
    },
    /** The projection ran from the inputs and into the targets of the last `held` question. */
    keep() {
      kept.set(next)
      for (let k = 0; k < asked.length; k++) masks[k] = asked[k]
    },
    /** The mask is no longer what the last projection wrote: the next `held` answers false. */
    drop() {
      masks.fill(undefined)
    },
  }
}

function sameMasks(a: readonly (object | undefined)[], b: readonly (object | undefined)[]) {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false
  return true
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
  key[at++] = inputs.trace
  key[at++] = size[0]
  key[at++] = size[1]
  key[at++] = inputs.maxLights
  key[at++] = lights.length
  key[at++] = inputs.gridCells
  key[at++] = inputs.gridWords
  key[at++] = inputs.gridCulled ? 1 : 0
  key[at++] = inputs.cullBackfacing ? 1 : 0
  key[at++] = inputs.contributors
  key[at++] = inputs.denoise
  const { field } = inputs
  key[at++] = field.generation
  key[at++] = field.revision
  key[at++] = field.shadowing ? 1 : 0
  key[at++] = field.quality
  key[at++] = field.fullResolution ? 1 : 0
  key[at++] = field.distanceScale
  key[at++] = field.farTransitionScale
  // A sun's first-person clipmap changes its mask as its own maps do: its first id is a digit of the light's.
  for (let k = 0; k < lights.length; k++)
    key[at++] = lights[k].mapId + MAP_RADIX * ((lights[k].firstPersonMapId ?? -1) + 1)
}
