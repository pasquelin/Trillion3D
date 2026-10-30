import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { octEncode } from '../../../../../../math/src/wgsl/octahedral.ts'
import { dagReadLayoutEntries } from '../../../../geometry/dag/shader/bindings.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { VIEW_RAY_WGSL } from '../../../deferred/worldAtWgsl.ts'
import {
  NO_SCENE_MASKS,
  type SceneMaskPrograms,
} from '../../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskedLayoutEntries, sceneMaskWgsl } from '../../../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../../../rays/sceneTrace/sceneTraceWgsl.ts'
import {
  HARDWARE_DISPATCH_X,
  HARDWARE_PARAMS,
  HARDWARE_RAYS_AT,
  HARDWARE_RAY_GROUP,
} from './layout.ts'

/** The format of the texture the trace writes what each ray met in: the hit's distance (an f32's bits), its flags (`HARDWARE_HIT`), its object, its normal (two snorm halves of an octahedral cell). */
export const HARDWARE_HIT_FORMAT: GPUTextureFormat = 'rgba32uint'
/** The bits of a hit's flags word: the ray met a triangle, its front face, a two-sided primitive. */
export const HARDWARE_HIT = { found: 1, front: 2, twoSided: 4 } as const

/** The bindings of group 0, clear of the cut's tables the scene trace reads (1, 6, 7, 9): the parameters, the list of rays, the hits written, the lighting's view. */
export const HARDWARE_TRACE_BINDINGS = { params: 20, rays: 21, hits: 22, view: 23 } as const
const B = HARDWARE_TRACE_BINDINGS
/** The group of the scene trace and its any-hit test, and its first binding. */
export const HARDWARE_TRACE_SCENE = { group: 1, first: 0 } as const

export const HARDWARE_TRACE_ENTRY = 'hardwareTrace'

/**
 * THE RAY FROM THE EYE THROUGH A PIXEL OF A DRAW (`eyeRayPixel`, `eyeRayOrigin`, `eyeRayDirection`), shared by the kernels that cast one: the pixel `coord` of a draw of `draw` pixels that shows the whole
 * display of `display`, with the raster's jitter taken off (the lighting's inverse view-projection carries it, as the image was drawn with it; the jitter is in pixels of the image, `view.viewport`), its
 * start in the camera's translated world and its direction. The program declares `view`.
 */
export const EYE_RAY_WGSL = wgslBlock(
  'EYE_RAY_WGSL',
  [VIEW_RAY_WGSL],
  `fn eyeRayPixel(coord:vec2u,draw:vec2f,display:vec2f)->vec2f{
 let jitter=vec2f(view.jitter.x,-view.jitter.y)*display/view.viewport.xy;
 return (vec2f(coord)+vec2f(0.5))/draw*display+jitter;
}
fn eyeRayOrigin(coord:vec2u,draw:vec2f,display:vec2f)->vec3f{return viewRayStart(eyeRayPixel(coord,draw,display),display)-view.display.yzw;}
fn eyeRayDirection(coord:vec2u,draw:vec2f,display:vec2f)->vec3f{return viewRay(eyeRayPixel(coord,draw,display),display);}`,
)

/**
 * THE HIT OF THAT RAY (`eyeRayHit`), cast from `range.x` to `range.y` metres through the scene's triangles under the scene trace's `flags`. The hit is the texel `HARDWARE_HIT_FORMAT` holds: the distance (an f32's
 * bits; the end of the range for a ray that met nothing), the flags (`HARDWARE_HIT`), the object and the normal; a trace that stopped before its walk was whole and held no hit is a hit with no
 * object at the end of the ray, as the probes' rays make it.
 */
export const EYE_RAY_HIT_WGSL = wgslBlock(
  'EYE_RAY_HIT_WGSL',
  [EYE_RAY_WGSL, octEncode],
  `fn eyeRayHit(coord:vec2u,draw:vec2f,display:vec2f,range:vec2f,flags:u32)->vec4u{
 let hit=stTrace(StRay(eyeRayOrigin(coord,draw,display),eyeRayDirection(coord,draw,display),range.x,range.y,flags));
 var found=0u;
 var reach=range.y;
 var owner=0xffffffffu;
 var normal=vec3f(0.0,0.0,1.0);
 if(hit.hit){
  found=${HARDWARE_HIT.found}u|select(0u,${HARDWARE_HIT.front}u,hit.frontFace)|select(0u,${HARDWARE_HIT.twoSided}u,hit.twoSided);
  reach=hit.distance;
  owner=hit.object;
  normal=hit.normal;
 }else if(!stComplete){
  found=${HARDWARE_HIT.found}u|${HARDWARE_HIT.front}u;
 }
 return vec4u(bitcast<u32>(reach),found,owner,pack2x16snorm(octEncode(normal)));
}`,
)

/** The layout of group 0: its own bindings and the cut's tables. */
export const hardwareTraceEntries = () => [
  computeUniformEntry(B.params),
  computeBufferEntry(B.rays, 'read-only-storage'),
  computeStorageTextureEntry(B.hits, HARDWARE_HIT_FORMAT),
  computeUniformEntry(B.view),
  ...dagReadLayoutEntries(),
]
/** The layout of the scene trace's group. */
export const hardwareTraceSceneEntries = () => sceneMaskedLayoutEntries(HARDWARE_TRACE_SCENE.first)

/**
 * THE TRACE OF THE LISTED RAYS (`hardwareTrace`), a thread a listed ray: the ray from the eye through the pixel of the draw the list names (the draw is traced at its own size and shows the whole
 * display), from the first to the last distance of the trace (`HardwareParams.trace`, metres), through the scene's triangles. The translucent primitives are passed; the faces `visualizeCullingMode`
 * names are culled. A trace that stopped before its walk was whole and held no hit is a hit with no object at the end of the ray, as the probes' rays make it; the hit is written to the hits' texture
 * at the ray's pixel for the shading kernel (`answerWgsl.ts`) to light, which is split from this one by WebGPU's limits of sampled textures.
 */
export const hardwareTraceWgsl = (programs: SceneMaskPrograms = NO_SCENE_MASKS) =>
  wgslProgram(
    `${HARDWARE_PARAMS.wgsl}
@group(0) @binding(${B.params}) var<uniform> scene:HardwareParams;
@group(0) @binding(${B.rays}) var<storage,read> work:array<u32>;
@group(0) @binding(${B.view}) var<uniform> view:View;
@group(0) @binding(${B.hits}) var hits:texture_storage_2d<${HARDWARE_HIT_FORMAT},write>;
fn hardwareCulling()->u32{
 if(scene.flags.z==1u){return ST_CULL_BACK;}
 if(scene.flags.z==2u){return ST_CULL_FRONT;}
 return 0u;
}
@compute @workgroup_size(${HARDWARE_RAY_GROUP},1,1)
fn ${HARDWARE_TRACE_ENTRY}(@builtin(workgroup_id) groupId:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=(groupId.y*${HARDWARE_DISPATCH_X}u+groupId.x)*${HARDWARE_RAY_GROUP}u+lane;
 if(index>=work[0]){return;}
 let packed=work[${HARDWARE_RAYS_AT}u+index];
 let coord=vec2u(packed&0xffffu,packed>>16u);
 textureStore(hits,coord,eyeRayHit(coord,vec2f(scene.size.xy),vec2f(scene.size.zw),scene.trace.xy,hardwareCulling()));
}`,
    [
      EYE_RAY_HIT_WGSL,
      sceneTraceWgsl(HARDWARE_TRACE_SCENE.group, HARDWARE_TRACE_SCENE.first),
      sceneMaskWgsl(HARDWARE_TRACE_SCENE.group, HARDWARE_TRACE_SCENE.first, programs),
    ],
  )
