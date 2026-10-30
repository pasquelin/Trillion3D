import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { NO_SCENE_MASKS, type SceneMaskPrograms } from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskedLayoutEntries, sceneMaskWgsl } from '../../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { SP_BENT_WGSL } from './historyWgsl.ts'
import { SP_OCCLUSION_CELLS, type OcclusionShape } from './occlusionWgsl.ts'
import { spSurface } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { SP_FIXED_CAST } from './traceWgsl.ts'

/** The bindings of the occlusion cast through the scene's triangles in group 0, clear of the cut's tables (1, 6, 7, 9): the screen probes' parameters, the image's
 *  normals and flags, the blue noise and the occlusion written (as `F.occlusion` says; with the bent normal, as `F.bentOcclusion`). */
export const OCCLUSION_TRIANGLES_BINDINGS = bindingTable({
  params: [20, 'uniform'],
  normals: [21, 'float'],
  flags: [22, 'uint'],
  blue: [23, 'float'],
  occlusion: [24, { store: F.occlusion }],
})
const B = OCCLUSION_TRIANGLES_BINDINGS.at
/** The scene trace's group and its first binding in it. */
export const OCCLUSION_TRIANGLES_SCENE = { group: 2, first: 0 } as const
/** The entry point of the program. */
export const OCCLUSION_TRIANGLES_ENTRY = 'occlusionTriangles'

/** The layout of the group 0 of the pass: its bindings, with the bent normal's word where the occlusion keeps it, and the cut's tables. */
export const occlusionTrianglesEntries = (bentNormal: boolean) => [
  ...OCCLUSION_TRIANGLES_BINDINGS.entries.map((entry) =>
    entry.binding === B.occlusion && bentNormal
      ? { ...entry, storageTexture: { ...entry.storageTexture!, format: F.bentOcclusion } }
      : entry,
  ),
  ...dagReadLayoutEntries(),
]
/** The layout of its scene trace group. */
export const occlusionTrianglesSceneEntries = () =>
  sceneMaskedLayoutEntries(OCCLUSION_TRIANGLES_SCENE.first)

/**
 * THE SHORT-RANGE OCCLUSION CAST THROUGH THE SCENE'S TRIANGLES (`occlusionTriangles`, `screenProbeShortRangeAOHardwareRayTracing`), a thread a texel of the
 * occlusion as the pass of the horizon search is (`spOcclusionPixel`): a pixel that is a lit surface casts `rays` rays — cosine distributed over its
 * hemisphere by the pixel's blue noise at the probes' gather state frame times the count plus the ray's rank — from its point moved off along its normal by
 * the setting's metres, as far as two tiles of pixels of the image's width at its depth (`spFixedWide`), the translucent primitives passed and the first hit of any
 * primitive ending the search. The amount is the share of the rays left open, the direction of the open sky their mean, as long as the amount, as the stochastic
 * hemisphere's is: the word the pass of the horizon search writes, which the next passes read as theirs.
 */
const occlusionTrianglesKernel = (
  shape: OcclusionShape,
  rays: number,
  bias: number,
) => `const SP_RAYS:u32=${rays}u;
const SP_NORMAL_BIAS:f32=${wgslF32(bias)};
@compute @workgroup_size(8,8)
fn ${OCCLUSION_TRIANGLES_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy*SP_OCCLUSION_DOWNSAMPLE>=sp.size.xy)){return;}
 let pixel=spOcclusionPixel(id.xy);
 let s=spSurfaceAt(pixel);
 var open=0.0;
 var bent=vec3f(0.0);
 var stored=vec3f(0.0,0.0,1.0);
 var amount=0.0;
 if(s.lit){
  let frame=frameAround(s.N);
  let reach=spFixedWide(s.P,2.0*f32(sp.size.z));
  let origin=s.P+s.N*SP_NORMAL_BIAS-view.display.yzw;
  for(var n=0u;n<SP_RAYS;n++){
   let d=outOfFrame(sampleCosineHemisphere(blueNoiseVec2(pixel,sp.frames.x*SP_RAYS+n)),frame);
   let hit=stTrace(StRay(origin,d,0.0,reach,ST_SKIP_TRANSLUCENT|ST_ANY_HIT));
   if(!hit.hit){
    open+=1.0;
    bent+=d;
   }
  }
  amount=open/f32(SP_RAYS);
  let norm=length(bent);
  stored=select(s.N*amount,bent*(amount/norm),norm>0.0);
 }
 ${shape.bentNormal ? 'textureStore(occlusion,vec2i(id.xy),vec4u(spBentPack(stored),0u,0u,0u));' : 'textureStore(occlusion,vec2i(id.xy),vec4f(round(saturate(amount)*255.0)/255.0,0.0,0.0,0.0));'}
}`

/** The program of the pass over the occlusion's `shape`, `samples` of a probe's tile, casting `rays` rays a pixel that cut the surfaces by the graph masks `programs`. */
export const occlusionTrianglesProgram = (
  shape: OcclusionShape,
  samples: readonly [number, number],
  rays: number,
  bias: number,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
) =>
  wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_OCCLUSION_DOWNSAMPLE: shape.downsample })}
${occlusionTrianglesKernel(shape, rays, bias)}`,
    [
      spCommon(samples),
      spSurface(B.normals, B.flags),
      blueNoiseWgsl(0, B.blue),
      SP_FIXED_CAST,
      SP_OCCLUSION_CELLS,
      ...(shape.bentNormal ? [SP_BENT_WGSL] : []),
      sceneTraceWgsl(OCCLUSION_TRIANGLES_SCENE.group, OCCLUSION_TRIANGLES_SCENE.first),
      sceneMaskWgsl(OCCLUSION_TRIANGLES_SCENE.group, OCCLUSION_TRIANGLES_SCENE.first, programs),
    ],
  )
