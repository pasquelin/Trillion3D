import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import type {
  BlendableLocation,
  StencilCompare,
  PostProcessBlendable,
} from '../../../../sdk-core/src/world/material/postProcessMaterial.ts'
import type { MaterialGraph } from '../../../../sdk-core/src/world/material/graph/api.ts'
import type { Slots } from '../../materials/graph/layout.ts'
import { TAA_VIEW } from '../taa/bindingsWgsl.ts'
import { putDepthTerms } from '../taa/view.ts'
import { POST_BLEND, POST_GIVEN, POST_VIEW, type PostBlend } from './postLayout.ts'
import type { PostProgram } from './postProgram.ts'

/** The bits of the stencil test's mask, the reference's (`ManualStencilTestMask`): the pixel is kept where the reference value is equal to
 *  its stencil, below it or above it. */
const STENCIL_EQUAL = 1
const STENCIL_LESS = 2
const STENCIL_GREATER = 4

/** The mask of the stencil comparison `compare`: which of the three outcomes of the reference value against the pixel's stencil it keeps. */
export function stencilMaskOf(compare: StencilCompare) {
  switch (compare) {
    case 'less':
      return STENCIL_LESS
    case 'lessEqual':
      return STENCIL_LESS | STENCIL_EQUAL
    case 'greaterEqual':
      return STENCIL_GREATER | STENCIL_EQUAL
    case 'equal':
      return STENCIL_EQUAL
    case 'greater':
      return STENCIL_GREATER
    case 'notEqual':
      return STENCIL_LESS | STENCIL_GREATER
    case 'never':
      return 0
    default:
      return STENCIL_LESS | STENCIL_EQUAL | STENCIL_GREATER
  }
}

/** The blend a material takes (`POST_BLEND`): without an output alpha its colour replaces the pixel's and its alpha is kept; with it, and
 *  where the project allows blend modes, the material's own blending where it is transparent — mixing by its opacity, adding, multiplying,
 *  laid over premultiplied or holding out —, else the colour and alpha replace the pixel. */
export function blendOf(material: Material, outputAlpha: boolean, allowBlend: boolean): PostBlend {
  if (!outputAlpha) return POST_BLEND.rgbOnly
  if (!allowBlend || material.transparent !== true) return POST_BLEND.replace
  switch (material.blending) {
    case 'normal':
      return POST_BLEND.translucent
    case 'additive':
      return POST_BLEND.additive
    case 'multiply':
      return POST_BLEND.modulate
    case 'alphaComposite':
      return POST_BLEND.alphaComposite
    case 'alphaHoldout':
      return POST_BLEND.alphaHoldout
    default:
      return POST_BLEND.replace
  }
}

/** Whether a material at `location` reads and writes the image as the display shows it: after the tone mapping, or in its place. The colours
 *  before it are in the exposure the image is held at (`View.PreExposure`). */
export const readsDisplayColour = (location: BlendableLocation) =>
  location === 'sceneColorAfterTonemapping' || location === 'replacingTonemapper'

/** The scales of the exposure a material at `place` applies: what it multiplies the pixel it writes by, and what it multiplies the images it
 *  reads by (one over it); both 1 after the tone mapping, or where the material turned it off. */
export function exposureScales(place: PostProcessBlendable, preExposure: number) {
  const applies = !readsDisplayColour(place.location) && !place.disablePreExposureScale
  return applies ? ([preExposure, 1 / preExposure] as const) : ([1, 1] as const)
}

/** What a frame says of the image being processed, the same for every material of it. */
export interface PostViewInput {
  readonly projection: ArrayLike<number>
  readonly perspective: boolean
  /** The image's size, then its texture's. */
  readonly image: readonly [number, number, number, number]
  /** The render size, then the size of the textures of the lit image and its depth. */
  readonly scene: readonly [number, number, number, number]
  /** The size of the custom depth targets. */
  readonly custom: readonly [number, number]
}

const terms = new Float32Array(TAA_VIEW.words)
/** Writes the frame's uniform (`POST_VIEW`) into `out`: the projection's depth terms, the sizes, and the exposure scales of the material at
 *  `place` (written again for each material, as they are its own). */
export function writePostView(
  out: Float32Array,
  frame: PostViewInput,
  scales: readonly [number, number],
) {
  putDepthTerms(
    out,
    { depth: POST_VIEW.depth, radius: POST_VIEW.radius },
    terms,
    frame.projection,
    frame.perspective,
    frame.scene[0],
  )
  out.set(frame.image, POST_VIEW.image)
  out.set(frame.scene, POST_VIEW.scene)
  out[POST_VIEW.custom] = frame.custom[0]
  out[POST_VIEW.custom + 1] = frame.custom[1]
  out[POST_VIEW.custom + 2] = 0
  out[POST_VIEW.custom + 3] = 0
  out[POST_VIEW.head] = scales[0]
  out[POST_VIEW.head + 1] = scales[1]
}

/** Writes a material's uniform (`POST_GIVEN`, then its graph's values) into `out`: its clocks, its plain colour and opacity, its flags
 *  and the values of its graph; false while the graph's values cannot be written. */
export function writePostGiven(
  out: ArrayBuffer,
  material: Material,
  place: PostProcessBlendable,
  flags: { blend: PostBlend; stencil: boolean },
  clocks: { time: number; realTime: number },
  program: PostProgram,
  weight: number,
) {
  const floats = new Float32Array(out, 0, POST_GIVEN.words)
  const words = new Uint32Array(out, 0, POST_GIVEN.words)
  floats[POST_GIVEN.head] = clocks.time
  floats[POST_GIVEN.head + 1] = clocks.realTime
  const emitted = material.emissive.toArray()
  const intensity = material.emissiveIntensity
  for (let c = 0; c < 3; c++) floats[POST_GIVEN.plain + c] = emitted[c] * intensity
  floats[POST_GIVEN.plain + 3] = material.opacity
  words[POST_GIVEN.flags] = flags.blend
  words[POST_GIVEN.flags + 1] = flags.stencil ? 1 : 0
  words[POST_GIVEN.flags + 2] = stencilMaskOf(place.stencilCompare)
  words[POST_GIVEN.flags + 3] = place.stencilRef
  const graph = material.graph as MaterialGraph | undefined
  if (!graph || !program.graph) return true
  const { slots } = program.graph
  // The graph reads no texture (`postProgramOf`), so no slot is asked of the atlas.
  const filled = slots.fill(graph, out, POST_GIVEN.words * 4, () => undefined)
  if (weight < 1) mixWithNeutral(slots, new Float32Array(out, POST_GIVEN.words * 4), weight)
  return filled
}

/** The values of the parameters `slots` hold, in `values`, mixed by `weight` with the ones the graph's nodes start from: a blendable
 *  that joins the image partly takes that share of what its material gives (`Blendables`). */
function mixWithNeutral(slots: Slots, values: Float32Array, weight: number) {
  slots.vectors.forEach((slot, at) => {
    for (let lane = 0; lane < 4; lane++) {
      // A colour parameter of three numbers is opaque; the lanes past a scalar's are zero.
      const start = slot.initial[lane] ?? (lane === 3 && !slot.scalar ? 1 : 0)
      const now = values[at * 4 + lane]
      values[at * 4 + lane] = start + (now - start) * weight
    }
  })
}
