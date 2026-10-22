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
/** The words' layers: the flags, then the shadow receiver's two words
 *  (`../../visibility/shader/receiverTargetWgsl.ts`). */
export const SURFACE_WORDS = { flags: 0, receiver: 1 } as const
/** The words the shadow receiver takes, a layer each: its offset's, then its plane's. */
export const SURFACE_RECEIVER_WORDS = 2
/** Layers of the words. */
export const SURFACE_WORD_LAYERS = SURFACE_WORDS.receiver + SURFACE_RECEIVER_WORDS

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
/** The tile rank a surface pixel asks of the virtual textures, after the surfaces: the feedback
 *  target, which the pipelines write or not (`FEEDBACK`, `../virtual/requestWgsl.ts`). */
export const REQUEST_OUTPUT = { name: 'request', wgsl: 'u32', format: FEEDBACK_FORMAT } as const
