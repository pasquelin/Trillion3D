import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import * as layer from './layers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'

/** The history update's bindings, in the order of its layout entries (`resolveWgsl.ts`). */
export const TAA_BINDINGS = {
  current: 0,
  history: 1,
  historySampler: 2,
  rejection: 3,
  vectors: 4,
  antiAliasing: 5,
  view: 6,
  flags: 7,
  shareHistory: 8,
  givenUp: 9,
  ...layer.LAYER_BINDINGS,
} as const

/** The history update's bind group layout: one entry per binding above. A flagless resolve
 *  neither binds nor reads the flags; a `filtered` one binds the layers'. */
export function createTaaLayout(device: GPUDevice, asIs = true, blended = false, filtered = false) {
  const stage = GPUShaderStage.FRAGMENT
  const entries: GPUBindGroupLayoutEntry[] = [
    computeTextureEntry(TAA_BINDINGS.current, 'unfilterable-float', '2d', stage),
    computeTextureEntry(TAA_BINDINGS.history, 'float', '2d', stage),
    computeSamplerEntry(TAA_BINDINGS.historySampler, 'filtering', stage),
    // The shading rejection of each render texel (`rejectionWgsl.ts`).
    computeTextureEntry(TAA_BINDINGS.rejection, 'float', '2d', stage),
    // The reprojection vector of each render texel, hole-filled (`reprojectWgsl.ts`).
    computeTextureEntry(TAA_BINDINGS.vectors, 'uint', '2d', stage),
    // The spatial anti-aliaser's offset and noise filtering (`spatialAntiAliasingWgsl.ts`).
    computeTextureEntry(TAA_BINDINGS.antiAliasing, 'uint', '2d', stage),
    computeBufferEntry(TAA_BINDINGS.view, 'uniform', stage),
    computeTextureEntry(TAA_BINDINGS.flags, blended ? 'float' : 'uint', '2d', stage),
    computeTextureEntry(TAA_BINDINGS.shareHistory, 'float', '2d', stage),
    // What the transparents over each render texel give up of its history (`GIVEN_UP_TARGET`).
    computeTextureEntry(TAA_BINDINGS.givenUp, 'float', '2d', stage),
  ]
  const kept = asIs ? entries : entries.filter(({ binding }) => binding !== TAA_BINDINGS.flags)
  return device.createBindGroupLayout({
    entries: [...kept, ...layer.layerEntries(filtered)],
  })
}

/** The pass uniform's fields (`TAA_VIEW_WGSL`), in order. */
export const TAA_VIEW = fieldLayout('TaaView', [
  ['prevViewProj', 'mat4x4f'],
  ['invViewProj', 'mat4x4f'],
  ['viewport', 'vec4f'],
  ['params', 'vec4f'],
  ['render', 'vec4f'],
  ['jitter', 'vec4f'],
  ['eye', 'vec4f'],
  ['exposure', 'vec4f'],
  ['parallax', 'vec4f'],
  ['rates', 'vec4f'],
  ['depth', 'vec4f'],
  ['radius', 'vec4f'],
  ['prevRender', 'vec4f'],
  ['analysisGrid', 'vec4f'],
  ['quality', 'vec4f'],
  ['tessellation', 'vec4f'],
  ['preExposure', 'vec4f'],
] as const)
export const TAA_VIEW_BYTES = TAA_VIEW.words * 4

/**
 * Pass uniform, read by every temporal pass. `prevViewProj` and `invViewProj` are REPORTED TO THIS
 * FRAME'S EYE and both WITHOUT jitter: the inverse yields, for an unshifted pixel centre and a depth,
 * a position relative to the eye; the previous one takes it as is — the anchoring of the partition,
 * so five-digit world coordinates do not eat the single precision of the reprojection.
 * - `viewport`: `(width, height, 1/width, 1/height)` of the display, which the history has;
 *   `render`: the same four of the grid this frame was drawn in; `prevRender`: of the grid the
 *   last image was drawn in, which the render-resolution histories hold; `analysisGrid`: of the textures
 *   those histories are allocated at.
 * - `params`: the history describes nothing — a cut, no history yet — (`x`), the display layers'
 *   history holds the last image's (`y`), a placement moved (`z`), what the resolve outputs in place
 *   of the accumulated colour (`w`, `taaViewCode`: 0 the colour, a diagnostic view's code else).
 * - `jitter`: this frame's offset in render pixels, its accumulated image's rank, and that rank
 *   among eight.
 * - `eye`: the eye in the world, and in `w` whether a GPU deformation moved this frame
 *   (`deformWgsl.ts`).
 * - `exposure`: the scale composition applies to the image (`x`: the exposure over the image's
 *   pre-exposure), every measured colour multiplied by it; the
 *   ratio of this image's exposure (the scale times the pre-exposure) to the last one's, which
 *   corrects the histories kept in an exposed space (`y`); the flicker count's fade-in rate (`z`, `flickerCountRate`), and a thin
 *   geometry region's, over three flicker periods (`w`, `THIN_GEOMETRY_PERIODS`).
 * - `parallax`: the last view-projection's image of the eye's move since the last image,
 *   `prevViewProj · (lastEye − eye, 0)`: what a point's last projection gains when the camera only
 *   turned.
 * - `rates`: the inverse of the parallax speed past which a pixel is moving to the flicker measure,
 *   in render pixels an image (`x`), and the blend factor a history fully kept takes the image at
 *   (`y`); the velocity passes' size test of an object (`writeObjectSize`): the share of the screen
 *   a unit of radius at a unit of distance takes (`z`) and the least radius that is measured,
 *   squared (`w`, 0 leaves no object out).
 * - `depth`: the projection's third and fourth rows' depth terms `(z·z, z·w, w·z, w·w)`, which turn a
 *   device depth into a scene depth and back (`depthWgsl.ts`); `radius`: a render pixel's world
 *   radius per unit of scene depth and at none (`xy`), and the sign of the view axis (`z`).
 * - `quality`: the level's knobs (`TaaLevelKnobs`, `levels.ts`): the flicker rejection on (`x`,
 *   1 or 0), the spatial anti-aliaser's samples a side, 0 for none (`y`), the history
 *   update's kernel moving its far neighbour (`z`, 1 or 0), and whether the thin geometry detection
 *   runs this image (`w`, 1 or 0: else the passes that read its mask read none).
 * - `tessellation`: whether the frame draws the surfaces that name a displacement tessellated
 *   (`x`, 1 or 0, the visibility uniform's word): the velocity passes then move a displaced texel by
 *   the point of its triangle under it (`pointBefore`, `deformWgsl.ts`). The other lanes are
 *   padding.
 * - `preExposure`: the ratio of this image's pre-exposure to the last one's (`x`), which the
 *   history's colour is multiplied by, to hold the light of the image before as this one holds its
 *   own (`historyRead`); `yzw` unused.
 */
export const TAA_VIEW_WGSL = wgslBlock('TAA_VIEW_WGSL', [], TAA_VIEW.wgsl)

/** The history update's bindings (`resolveWgsl.ts`). */
export const BINDINGS_WGSL = wgslBlock(
  'BINDINGS_WGSL',
  [TAA_VIEW_WGSL],
  `
@group(0) @binding(${TAA_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.history}) var history:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.historySampler}) var historySampler:sampler;
@group(0) @binding(${TAA_BINDINGS.rejection}) var rejection:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.antiAliasing}) var antiAliasing:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${TAA_BINDINGS.shareHistory}) var shareHistory:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.givenUp}) var givenUp:texture_2d<f32>;`,
)
export const shareBindingsWgsl = (blended: boolean) =>
  wgslBlock(
    `shareBindingsWgsl(${blended})`,
    [],
    `
@group(0) @binding(${TAA_BINDINGS.flags}) var flags:texture_2d<${blended ? 'f32' : 'u32'}>;`,
  )
