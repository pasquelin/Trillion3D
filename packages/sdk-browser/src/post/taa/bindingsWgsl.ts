import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { TEXTURE_FORMATS_TIER1_WGSL } from '../../gpu/core/textureFormatsTier.ts'
import * as layer from './layers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../gpu/core/computeBindings.ts'

/** The history update's bindings, in the order of its layout entries (`resolveWgsl.ts`). */
export const TAA_BINDINGS = {
  sceneColor: 0,
  history: 1,
  historySampler: 2,
  rejection: 3,
  vectors: 4,
  antiAliasing: 5,
  view: 6,
  validityHistory: 8,
  ...layer.LAYER_BINDINGS,
  historyResurrected: 14,
  validityResurrected: 15,
  jacobian: 16,
  boundary: 17,
  // The storage textures it writes: the history's colour and validity, and the half-size image.
  historyOut: 18,
  validityOut: 19,
  halfOut: 20,
} as const

/** What a history update is made for: whether it resolves the display layers too (`filtered`),
 *  whether it writes the half-size image beside the colour (`half`), and the formats of the colour
 *  and the validity it stores to. */
export interface UpdateShape {
  readonly filtered: boolean
  readonly half: boolean
  readonly color: GPUTextureFormat
  readonly validity: GPUTextureFormat
}

/** The history update's bind group layout, seen by the compute stage: one entry per binding above.
 *  A `filtered` one binds the layers'; one that writes the half-size image binds it. */
export function createTaaLayout(device: GPUDevice, shape: UpdateShape) {
  const entries: GPUBindGroupLayoutEntry[] = [
    // The scene colour the shading rejection wrote, in the history's colour format
    // (`sceneColorWgsl`, `rejectionWgsl.ts`).
    computeBufferEntry(TAA_BINDINGS.sceneColor, 'read-only-storage'),
    computeTextureEntry(TAA_BINDINGS.history, 'float'),
    computeSamplerEntry(TAA_BINDINGS.historySampler, 'filtering'),
    // The shading rejection of each render texel (`rejectionWgsl.ts`).
    computeTextureEntry(TAA_BINDINGS.rejection, 'float'),
    // The reprojection vector of each render texel, hole-filled (`reprojectWgsl.ts`).
    computeTextureEntry(TAA_BINDINGS.vectors, 'uint'),
    // The spatial anti-aliaser's offset and noise filtering (`spatialAntiAliasingWgsl.ts`).
    computeTextureEntry(TAA_BINDINGS.antiAliasing, 'uint'),
    computeBufferEntry(TAA_BINDINGS.view, 'uniform'),
    computeTextureEntry(TAA_BINDINGS.validityHistory, 'float'),
    // The frame a pixel may be resurrected from: its colour and its validity
    // (`historyFrames.ts`), the last image's again where the history resurrects nothing.
    computeTextureEntry(TAA_BINDINGS.historyResurrected, 'float'),
    computeTextureEntry(TAA_BINDINGS.validityResurrected, 'float'),
    // The reprojection field's jacobian and boundary of each render texel
    // (`reprojectionFieldWgsl.ts`), read where the level reprojects by the field.
    computeTextureEntry(TAA_BINDINGS.jacobian, 'uint'),
    computeTextureEntry(TAA_BINDINGS.boundary, 'uint'),
    // The frame the update writes: its colour and its validity.
    computeStorageTextureEntry(TAA_BINDINGS.historyOut, shape.color),
    computeStorageTextureEntry(TAA_BINDINGS.validityOut, shape.validity),
  ]
  return device.createBindGroupLayout({
    entries: [
      ...entries,
      ...layer.layerEntries(shape.filtered),
      // The half-size image in the history's colour format (`halfImageBytes`).
      ...(shape.half ? [computeStorageTextureEntry(TAA_BINDINGS.halfOut, shape.color)] : []),
    ],
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
  ['parallax', 'vec4f'],
  ['rates', 'vec4f'],
  ['depth', 'vec4f'],
  ['radius', 'vec4f'],
  ['prevRender', 'vec4f'],
  ['analysisGrid', 'vec4f'],
  ['quality', 'vec4f'],
  ['preExposure', 'vec4f'],
  ['history', 'vec4f'],
  ['fraction', 'vec4f'],
  ['resurrection', 'vec4f'],
  ['resurrectGrid', 'vec4f'],
  ['thin', 'vec4f'],
  ['thinFade', 'vec4f'],
  ['toResurrection', 'mat4x4f'],
  ['exactEye', 'array<vec4u,2>'],
] as const)
export const TAA_VIEW_BYTES = TAA_VIEW.words * 4

/**
 * Pass uniform, read by every temporal pass. `prevViewProj` and `invViewProj` are REPORTED TO THIS
 * FRAME'S EYE and both WITHOUT jitter: the inverse yields, for an unshifted pixel centre and a depth,
 * a position relative to the eye; the previous one takes it as is — the anchoring of the partition,
 * so five-digit world coordinates do not eat the single precision of the reprojection.
 * - `viewport`: `(width, height, 1/width, 1/height)` of the history, which the history update
 *   writes and reads (the display's, or twice it);
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
 * - `parallax`: the last view-projection's image of the eye's move since the last image,
 *   `prevViewProj · (lastEye − eye, 0)`: what a point's last projection gains when the camera only
 *   turned.
 * - `rates`: the inverse of the parallax speed past which a pixel is moving to the flicker measure,
 *   in render pixels an image (`x`), and the blend factor a history fully kept takes the image at
 *   (`y`), and whether the shading rejection is in its responsive mode (`z`, 1 or 0,
 *   `temporalShadingRejectionMode`), and whether the flicker measure considers the thin geometry
 *   detection's relaxation (`w`, 1 or 0, `temporalThinGeometryAntiFlickering`).
 * - `depth`: the projection's third and fourth rows' depth terms `(z·z, z·w, w·z, w·w)`, which turn a
 *   device depth into a scene depth and back (`depthWgsl.ts`); `radius`: a render pixel's world
 *   radius per unit of scene depth and at none (`xy`), and the sign of the view axis (`z`).
 * - `quality`: the level's knobs (`TaaLevelKnobs`, `levels.ts`): the flicker rejection on (`x`,
 *   1 or 0), the spatial anti-aliaser's samples a side, 0 for none (`y`), the history
 *   update's kernel moving its far neighbour (`z`, 1 or 0), and whether the thin geometry detection
 *   runs this image (`w`, 1 or 0: else the passes that read its mask read none).
 * - `preExposure`: the ratio of this image's pre-exposure to the last one's (`x`), which the
 *   history's colour and the histories kept in an exposed space are multiplied by, to hold the light
 *   of the image before as this one holds its own (`historyRead`); the factor the measures of the
 *   shading rejection are lifted by, two to the power of `temporalShadingExposureOffset` (`y`); the
 *   flicker count's fade-in rate (`z`, `flickerCountRate`), and a thin geometry region's, over three
 *   flicker periods (`w`, `THIN_GEOMETRY_PERIODS`).
 * - `history`: the history's sample laws (`historySampleLaws`): the most samples a history pixel
 *   holds (`x`), the weight an image of full alignment takes (`y`), the validity's drop after a
 *   full rejection (`z`) and at the speed setting (`w`).
 * - `fraction`: the speed's scale, over the history's pixel (`x`, `historySampleLaws`); the history's
 *   size over the display's per axis (`y`); the squared speed, in render pixels an image, from which
 *   the reprojection field anti-aliases its dilation by the depth (`z`); whether the level
 *   reprojects by the field (`w`, 1 or 0).
 * - `resurrection`: whether this image may resurrect a pixel from another frame (`x`, 1 or 0),
 *   the ratio of this image's pre-exposure to that frame's, which its colour is multiplied by (`y`);
 *   `zw` unused.
 *   `resurrectGrid`: the grid of that frame, as `render` is of this one; `toResurrection`: this
 *   frame's clip space, at the eye of this one, to that frame's.
 * - `thin`: the thin geometry detection's thresholds (`temporalThinGeometryErrorMultiplier` and its
 *   neighbours): the depth step past which a texel is a thin line, in pixel depth errors (`x`), the
 *   luma contrast past which it is a line of light (`y`), the relaxation weight of a high contrast
 *   line (`z`) and the translucency's share of a texel's luma past which its thin geometry is rejected (`w`).
 *   `thinFade`: how often a high contrast line not seen again fades outside a cluster hole region
 *   (`x`) and inside one (`y`), the greatest relaxation weight of a cluster hole region (`z`), whether the range varies (`w`, 1 or 0: the foliage
 *   alone takes the dilation, `varyingRange`, `view.ts`).
 * - `exactEye`: the eye in doubles, two words a coordinate, as the cut's view holds it
 *   (`packDoubles`): the velocity takes a placement's pose at it, now and as the last drawn frame
 *   drew it (`placementMotion`, `nearestSurfaceWgsl.ts`).
 */
export const TAA_VIEW_WGSL = wgslBlock('TAA_VIEW_WGSL', [], TAA_VIEW.wgsl)

/** The storage formats that need the language extension `texture_formats_tier1` (§ 6.6.1 "Texel
 *  Formats" of the WGSL specification, https://www.w3.org/TR/WGSL/#texel-formats): those of the
 *  packed history (`historyShape.ts`). */
const NEEDS_TIER1 = new Set<GPUTextureFormat>([
  'rg11b10ufloat',
  'rg8unorm',
  'rg8uint',
  'rgb10a2unorm',
  'r8unorm',
  'r8uint',
])

/** The declarations a program that stores to `formats` opens with: the `requires` of the language
 *  extension that gives them, none for the core's formats. */
export const packedStorageWgsl = (...formats: GPUTextureFormat[]) =>
  formats.some((format) => NEEDS_TIER1.has(format)) ? [TEXTURE_FORMATS_TIER1_WGSL] : []

/** The history update's bindings (`resolveWgsl.ts`): the storage textures it writes in the
 *  formats of `shape`, the half-size image's where it writes one. */
export const bindingsWgsl = (shape: Pick<UpdateShape, 'color' | 'validity' | 'half'>) =>
  wgslBlock(
    `bindingsWgsl(${shape.color}, ${shape.validity}, ${shape.half})`,
    [TAA_VIEW_WGSL, ...packedStorageWgsl(shape.color, shape.validity)],
    `
@group(0) @binding(${TAA_BINDINGS.sceneColor}) var<storage,read> sceneColor:array<u32>;
@group(0) @binding(${TAA_BINDINGS.history}) var history:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.historySampler}) var historySampler:sampler;
@group(0) @binding(${TAA_BINDINGS.rejection}) var rejection:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.antiAliasing}) var antiAliasing:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${TAA_BINDINGS.validityHistory}) var validityHistory:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.historyResurrected}) var historyResurrected:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.validityResurrected}) var validityResurrected:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.jacobian}) var jacobian:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.boundary}) var boundary:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.historyOut}) var historyOut:texture_storage_2d<${shape.color},write>;
@group(0) @binding(${TAA_BINDINGS.validityOut}) var validityOut:texture_storage_2d<${shape.validity},write>;${
      shape.half
        ? `
@group(0) @binding(${TAA_BINDINGS.halfOut}) var halfOut:texture_storage_2d<${shape.color},write>;`
        : ''
    }`,
  )
