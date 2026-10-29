import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE PATH TRACER'S PARAMETERS OF A DISPATCH (`ptView`, a uniform read at a dynamic offset: each dispatch of an image has its own block, since the bounce it
 * runs is one of them):
 * - `inverseViewProjection` the image's, which takes a pixel and its depth back to the world, and `viewProjection` its inverse, which takes a world point to the depth the frame stores;
 * - `eye` the eye in the world, in metres (the scene trace works relative to it, the surface cache's cards in the world), and in `w` the pre-exposure the accumulation was started
 *   with (`BaseExposure`: the light of a path is multiplied by it, and the display divides what it shows by the pre-exposure of the image);
 * - `tile` the first pixel of the tile and its size, `image` the view's size, the samples the pixel gathers at most (`maxSamples`) and the sample this is (`iteration`);
 * - `seeds` the temporal seed of the random sequence, the most bounces a path takes, the way lights are integrated (`pathTracingMISMode`), the sampler type;
 * - `limits` the brightest a path off the camera adds (`pathTracingMaxPathIntensity`, held to a half float), the caustics' approximation (1 or 0), the alpha of a pixel that
 *   meets nothing, the blend factor of the accumulation (1 over the samples gathered after this one);
 * - `flags` the bits `PT_VIEW_FLAG` and the capture (`PT_CAPTURE`) in the first word (emissive surfaces light the scene), which lights the camera sees (`pathTracingVisibleLights`), whether adaptive sampling is on, the bounce this dispatch runs;
 * - `counts` the number of lights, the paths a list of the queue holds, the last bounce whose paths are compacted (`pathTracingCompactionDepth`) and the word of the queue its lists begin at (`queueListBase`);
 * - `sampling` the error threshold of adaptive sampling, the width of the camera's anti-aliasing filter (`pathTracingFilterWidth`), the round of the bounce this dispatch runs (0 is the bounce itself, the later
 *   rounds trace again the rays that went through a surface that did not cover them) and the most rounds a bounce takes.
 */
export const PT_VIEW = fieldLayout('PtView', [
  ['inverseViewProjection', 'mat4x4f'],
  ['viewProjection', 'mat4x4f'],
  ['eye', 'vec4f'],
  ['tile', 'vec4u'],
  ['image', 'vec4u'],
  ['seeds', 'vec4u'],
  ['limits', 'vec4f'],
  ['flags', 'vec4u'],
  ['counts', 'vec4u'],
  ['sampling', 'vec4f'],
] as const)

/** Bytes of one block of the parameters, the stride of the dynamic offset: a multiple of the device's uniform offset alignment (256 at most). */
export const PT_VIEW_STRIDE = 256

export const PT_VIEW_WGSL = wgslBlock('PT_VIEW_WGSL', [], PT_VIEW.wgsl)

/** The bits of the first word of `ptView.flags`: whether emissive surfaces light the scene, whether the camera's ray goes through the meshes that are translucent whole (the views without them, `pathTracingVisualizeIncludeTranslucent` off), whether it meets the back faces of the surfaces (only the view of the kind of hit; the camera's ray otherwise ignores them, to match the raster), then from `PT_CAPTURE_SHIFT` the field the trace of a view of the payload keeps in the hit record in place of the surface's row (`PT_CAPTURE`). */
export const PT_VIEW_FLAG = { emissive: 1, skipTranslucent: 2, keepBackFaces: 4 } as const
export const PT_CAPTURE_SHIFT = 3

/** The fields the trace writes in place of a hit's row flags, for the views whose value only the trace knows (the hit is then shaded as no class, the shade of the hits passes it by): the hash of the instance and the triangle, of the instance and the cluster, of the instance, and the lighting channels of the instance's object. */
export const PT_CAPTURE = { none: 0, triangle: 1, instance: 2, cluster: 3, channels: 4 } as const

export const PT_VIEW_FLAGS_WGSL = wgslBlock(
  'PT_VIEW_FLAGS_WGSL',
  [PT_VIEW_WGSL],
  `fn ptEmissive()->bool{return (ptView.flags.x&${PT_VIEW_FLAG.emissive}u)!=0u;}
fn ptSkipsTranslucent()->bool{return (ptView.flags.x&${PT_VIEW_FLAG.skipTranslucent}u)!=0u;}
fn ptKeepsBackFaces()->bool{return (ptView.flags.x&${PT_VIEW_FLAG.keepBackFaces}u)!=0u;}
fn ptCapture()->u32{return (ptView.flags.x>>${PT_CAPTURE_SHIFT}u)&7u;}`,
)

/** The rounds a bounce takes after its own, at most: a ray goes through that many surfaces that do not cover it in one bounce, the last of them covering it whatever its opacity. */
export const PT_PASS_ROUNDS = 4

/** The dispatches of a bounce at most: its own round and the rounds after it. */
export const PT_STEPS = PT_PASS_ROUNDS + 1

/** The round of the dispatch and the last round a bounce takes (`ptView.sampling`). */
export const PT_ROUND_WGSL = wgslBlock(
  'PT_ROUND_WGSL',
  [PT_VIEW_WGSL],
  `fn ptRound()->u32{return u32(ptView.sampling.z);}
fn ptRounds()->u32{return u32(ptView.sampling.w);}`,
)
