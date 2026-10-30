import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { MAX_CLOSURES } from '../../../../sdk-core/src/world/material/graph/closures.ts'
import { FEEDBACK_FORMAT } from '../../scene/targetFormats.ts'

/** The format of the surfaces' colour layers (`SurfaceBuffer.colours`). */
export const SURFACE_COLOURS_FORMAT = 'rgba16float'
/** The format of the surfaces' word layers (`SurfaceBuffer.words`): the narrowest a compute stage
 *  stores, an 8-bit target being none. */
export const SURFACE_WORDS_FORMAT = 'r32uint'
/** The colours' first layers, the lighting reads through one binding of them: the base colour and
 *  metalness, then the normal and roughness; the emission follows when the frame holds it
 *  (`SurfaceBuffer.layers`). */
export const SURFACE_COLOUR_LAYERS = { base: 0, normal: 1 } as const
/** The words' layers: the flags. */
export const SURFACE_WORDS = { flags: 0 } as const
/** Layers of the words. */
export const SURFACE_WORD_LAYERS = 1

/** THE SURFACE TARGETS a pass writes before lighting, in the order of the surfaces' views
 *  (`SurfaceBuffer.views`): name, WGSL type, format, and the layered target and layer that hold it
 *  — the emission and occlusion's layer is the frame's (`SurfaceBuffer.layers`). The opaque resolve
 *  builds its output struct and its stores from this one table
 *  (`../../visibility/shader/shadeOutputsWgsl.ts`; `surfaceBuffer.ts` holds what each one stores). */
export const SURFACE_OUTPUTS = [
  {
    name: 'baseMetal',
    wgsl: 'vec4f',
    format: SURFACE_COLOURS_FORMAT,
    target: 'colours',
    layer: SURFACE_COLOUR_LAYERS.base,
  },
  {
    name: 'normalRough',
    wgsl: 'vec4f',
    format: SURFACE_COLOURS_FORMAT,
    target: 'colours',
    layer: SURFACE_COLOUR_LAYERS.normal,
  },
  {
    name: 'emissiveAo',
    wgsl: 'vec4f',
    format: SURFACE_COLOURS_FORMAT,
    target: 'colours',
    layer: undefined,
  },
  {
    name: 'flags',
    wgsl: 'u32',
    format: SURFACE_WORDS_FORMAT,
    target: 'words',
    layer: SURFACE_WORDS.flags,
  },
] as const
/** The place of a surface in the surfaces' views (`SurfaceBuffer.views`), found by its name in `SURFACE_OUTPUTS`. */
export const viewOf = (name: (typeof SURFACE_OUTPUTS)[number]['name']) =>
  SURFACE_OUTPUTS.findIndex((output) => output.name === name)
/** The place of the flags in the surfaces' views. */
export const FLAGS_VIEW = viewOf('flags')
/** The tile rank a surface pixel asks of the virtual textures, after the surfaces: the feedback
 *  target, which the pipelines write or not (`FEEDBACK`, `../virtual/requestWgsl.ts`). */
export const REQUEST_OUTPUT = { name: 'request', wgsl: 'u32', format: FEEDBACK_FORMAT } as const

/**
 * THE CLOSURE SLICES of the surface record, for a view whose pixels hold several closures (`effectiveMaxClosures`): the record keeps the
 * layers of `SURFACE_OUTPUTS` for the first closure and, for each closure past it, two more colour layers — the base colour and
 * metalness, then the normal and roughness — after the frame's own, and the words hold, after the flags, the coverage of every closure
 * (one word each), for each closure past the first its own flags and lobes (`CLOSURE_LOBE_LAYERS`) and the closure offsets (one word, the last). A view whose most is one closure holds none of them: its record is the single-closure
 * one, byte for byte. The colour layer of the first closure past the first and the closures held are in the layers word the head carries
 * (`SurfaceBuffer.layers`).
 */
export const SURFACE_CLOSURES = {
  /** The colour layers each closure past the first takes. */
  colours: 2,
  /** The layers of the head's word the colour layer past the frame's own and the closures held sit in, a byte each. */
  headShift: { colours: 16, held: 24 },
} as const

/** The closure count a record holds for a view's most `count`: none past one. */
export const closuresHeld = (count: number) => (count > 1 ? Math.floor(count) : 1)

/** The colour layers `count` closures add. */
export const closureColourLayers = (count: number) =>
  SURFACE_CLOSURES.colours * (closuresHeld(count) - 1)

/** The word layers each closure past the first keeps for its own model and lobes: its flags (the pixel's flags with the closure's specular and lobe mark), then the four words of its lobes texel (`PHYSICAL_LOBES_FORMAT`, `physicalLobes.ts`). */
export const CLOSURE_LOBE_LAYERS = 5

/** The word layers `count` closures add: a coverage each, the flags and lobes of each closure past the first, and the offsets (the last layer). */
export const closureWordLayers = (count: number) =>
  closuresHeld(count) > 1
    ? closuresHeld(count) + 1 + CLOSURE_LOBE_LAYERS * (closuresHeld(count) - 1)
    : 0

/** The closures a record holds, from the number of layers of its words (the inverse of `closureWordLayers`): one for a record of none. A host lists it. */
export const closuresHeldOf = wgslFn(
  'closuresHeldOf',
  [],
  `fn closuresHeldOf(layers:u32)->u32{return max((layers+${CLOSURE_LOBE_LAYERS - SURFACE_WORD_LAYERS - 1}u)/${CLOSURE_LOBE_LAYERS + 1}u,1u);}`,
)

/** The colour layer of the normal and roughness of closure `k`, one past the first, in a record whose frame's own layers number `own` (the head's word, `SURFACE_CLOSURES.headShift.colours`). */
export const closureNormalLayer = (own: number, k: number) =>
  own + SURFACE_CLOSURES.colours * (k - 1) + SURFACE_COLOUR_LAYERS.normal

/** The word layer of closure `k`'s coverage. */
export const closureCoverageLayer = (k: number) => SURFACE_WORD_LAYERS + k

/** The coverage word of a closure: `COVERAGE_PRESENT` marks the closure present, the low sixteen bits (up to `COVERAGE_MAX`) its coverage,
 *  zero to one. A word of zero is a closure the pixel does not have (a texel cleared, or a surface of one closure). The offsets word
 *  follows the last closure's: `SURFACE_WORD_LAYERS` plus the closures held. */
export const COVERAGE_PRESENT = 0x10000
export const COVERAGE_MAX = 0xffff
/** The luminance weight of a closure, in the bits above `COVERAGE_PRESENT` (fifteen, up to `LUMINANCE_MAX`): one where no vertical layering covers
 *  it, else what the tops it is the base of let through (`closureLayerWeight`). */
export const LUMINANCE_SHIFT = 17
export const LUMINANCE_MAX = 0x7fff
/** The bits of a closure's entry in the closure offsets word, and their mask. */
export const SURFACE_CLOSURE_OFFSET_BITS = 4
export const SURFACE_CLOSURE_OFFSET_MASK = 0xf

/** The closures a pixel has, by its offsets word (the first, and one for each step that is not zero, never past what the record holds, `held`): the one count every shader that loops a pixel's closures reads. */
export const closureCountOf = wgslFn(
  'closureCountOf',
  [],
  `fn closureCountOf(offsets:u32,held:u32)->u32{
 var count=1u;
 for(var k=1u;k<min(held,${MAX_CLOSURES}u);k++){
  if(((offsets>>(${SURFACE_CLOSURE_OFFSET_BITS}u*k))&${SURFACE_CLOSURE_OFFSET_MASK}u)!=0u){count=k+1u;}
 }
 return count;
}`,
)

/** The word layer of the flags of closure `closure` (from 1) in a record of `held` closures: after the coverages; the four words of its lobes texel follow it. */
export const closureFlagsLayerOf = wgslFn(
  'closureFlagsLayerOf',
  [],
  `fn closureFlagsLayerOf(held:u32,closure:u32)->u32{return ${SURFACE_WORD_LAYERS}u+held+${CLOSURE_LOBE_LAYERS}u*(closure-1u);}`,
)

/** The word layer of the first word of the lobes texel of closure `closure` (from 1). */
export const closureLobesLayerOf = wgslFn(
  'closureLobesLayerOf',
  [closureFlagsLayerOf],
  `fn closureLobesLayerOf(held:u32,closure:u32)->u32{return closureFlagsLayerOf(held,closure)+1u;}`,
)

/** The word layer of the closure offsets of a record of `held` closures (two or more): the last, after the lobes of the last closure. */
export const closureOffsetsLayerOf = wgslFn(
  'closureOffsetsLayerOf',
  [closureFlagsLayerOf],
  `fn closureOffsetsLayerOf(held:u32)->u32{return closureFlagsLayerOf(held,held);}`,
)
