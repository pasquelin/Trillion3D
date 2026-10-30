/**
 * THE RAYS OF THE SHADOW CASTER VIEWS (`../frame.ts`): one ray a pixel of the view's draw, from the eye through the pixel, cast against the scene's triangles (`../../../rays/sceneTrace/sceneTraceWgsl.ts`).
 * The draw is traced at its own size and shows the whole display, so a tile of an overview takes the rays of a smaller image. The ray goes from the eye to the greatest distance (`casters.trace.y`, metres),
 * ends at the first triangle it meets, passes the placements that cast no shadow and the meshes all of whose primitives are translucent, and meets the faces its flags allow (`CASTER_RAY`). The ray is the scene view's
 * (`EYE_RAY_HIT_WGSL`). What it meets is written at its pixel for the view's fragment stage (`../visualizeWgsl.ts`) to paint: the distance (an f32's bits), a word that says it met a triangle, the object, the normal (two snorm
 * halves of an octahedral cell); a ray that met nothing writes, in place of its distance, the sky it reaches: the sky light's radiance along the ray through the composition's table, as four bytes.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import {
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { dagReadLayoutEntries } from '../../../../geometry/dag/shader/bindings.ts'
import { SKY_READ_WGSL } from '../../../atmosphere/skyReadWgsl.ts'
import {
  skyLightReadLayoutEntries,
  skyLightReadWgsl,
} from '../../../../modules/sky/skyLight/read.ts'
import { toneReadEntries } from '../../../toneLutRead.ts'
import { visualizeTonemapReadWgsl } from '../../../surfaceCache/sceneDebug/visualizeTonemap.ts'
import {
  EYE_RAY_HIT_WGSL,
  HARDWARE_HIT,
} from '../../../surfaceCache/sceneDebug/hardware/traceWgsl.ts'
import {
  NO_SCENE_MASKS,
  type SceneMaskPrograms,
} from '../../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskedLayoutEntries, sceneMaskWgsl } from '../../../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../../../rays/sceneTrace/sceneTraceWgsl.ts'

/** The format of the texture the rays write what they met in. */
export const CASTER_HITS_FORMAT: GPUTextureFormat = 'rgba32uint'
/** The bit of a hit's second word that says the ray met a triangle. */
export const CASTER_HIT_FOUND = HARDWARE_HIT.found

/** The side of a workgroup, in threads. */
export const CASTERS_GROUP = 8

/** The scene trace's group and its first binding in it; group 0 holds the view's own bindings beside the cut's tables (at 1, 6, 7 and 9). */
export const CASTERS_SCENE = { group: 1, first: 0 } as const
/** The sky light's group (`skyLightReadWgsl`) and its bindings in it. */
export const CASTERS_SKY = { group: 2, cube: 0, sampler: 1, harmonics: 2, params: 3 } as const
/** The composition's table (`visualizeTonemapReadWgsl`) takes the three bindings from `tone + 1` in group 0. */
export const CASTERS_BINDINGS = { params: 20, hits: 21, view: 22, tone: 30 } as const
const B = CASTERS_BINDINGS

/**
 * The parameters of a draw, one uniform: `size` the pixels across and down the draw is traced at, then the display's; `trace` the first and last distance of a ray (metres); `ray` the flags of
 * the rays (`CASTER_RAY`) in `x`, in `y` whether the composition's table is baked to read the sky through.
 */
export const CASTERS_PARAMS = fieldLayout('CastersParams', [
  ['size', 'vec4u'],
  ['trace', 'vec4f'],
  ['ray', 'vec4u'],
] as const)

/** The words of the rays' flags, named as the scene trace's constants (`sceneTraceWgsl.ts`) in the kernel. */
export const CASTER_RAY = {
  /** Every triangle is met whole: the cut-out masks are not evaluated (the rays of a view with no material evaluation). */
  opaque: 1,
  /** The back of one-sided triangles is ignored. */
  cullBack: 2,
} as const

export const CASTERS_ENTRY = 'castersTrace'

/** The layout of group 0: the parameters, the hits written, the lighting's view and the cut's tables. */
export const castersEntries = () => [
  computeUniformEntry(B.params),
  computeStorageTextureEntry(B.hits, CASTER_HITS_FORMAT),
  computeUniformEntry(B.view),
  ...toneReadEntries(B.tone + 1, GPUShaderStage.COMPUTE),
  ...dagReadLayoutEntries(),
]
/** The layout of the sky light's group. */
export const castersSkyEntries = () =>
  skyLightReadLayoutEntries(CASTERS_SKY, GPUShaderStage.COMPUTE)
/** The layout of the scene trace's group. */
export const castersSceneEntries = () => sceneMaskedLayoutEntries(CASTERS_SCENE.first)

/** The kernel over the graph masks `programs` the rays cut the surfaces by. */
export const castersWgsl = (programs: SceneMaskPrograms = NO_SCENE_MASKS) =>
  wgslProgram(
    `${CASTERS_PARAMS.wgsl}
@group(0) @binding(${B.params}) var<uniform> casters:CastersParams;
@group(0) @binding(${B.view}) var<uniform> view:View;
@group(0) @binding(${B.hits}) var hits:texture_storage_2d<${CASTER_HITS_FORMAT},write>;
@compute @workgroup_size(${CASTERS_GROUP},${CASTERS_GROUP},1)
fn ${CASTERS_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=casters.size.xy)){return;}
 let draw=vec2f(casters.size.xy);
 let display=vec2f(casters.size.zw);
 var flags=ST_SHADOW;
 if((casters.ray.x&${CASTER_RAY.opaque}u)!=0u){flags|=ST_FORCE_OPAQUE;}
 if((casters.ray.x&${CASTER_RAY.cullBack}u)!=0u){flags|=ST_CULL_BACK;}
 var texel=eyeRayHit(id.xy,draw,display,casters.trace.xy,flags);
 if((texel.y&${CASTER_HIT_FOUND}u)==0u){
  let sky=visualizeTonemap(skyRadiance(eyeRayDirection(id.xy,draw,display)),casters.ray.y!=0u);
  texel.x=pack4x8unorm(vec4f(saturate(sky),1.0));
 }
 textureStore(hits,vec2i(id.xy),texel);
}`,
    [
      EYE_RAY_HIT_WGSL,
      skyLightReadWgsl(CASTERS_SKY),
      SKY_READ_WGSL,
      visualizeTonemapReadWgsl(B.tone),
      sceneTraceWgsl(CASTERS_SCENE.group, CASTERS_SCENE.first),
      sceneMaskWgsl(CASTERS_SCENE.group, CASTERS_SCENE.first, programs),
    ],
  )
