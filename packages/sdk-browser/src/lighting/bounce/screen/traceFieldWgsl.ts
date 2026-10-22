import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spFar } from './farFieldWgsl.ts'
import { spProbes } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { spRays } from './traceWgsl.ts'

/** The field trace's bindings: the probes' records and pixels, the ray words, the radiance written and the ends read and
 *  written in place, the cascades, the light buffer (the sky it holds). */
export const TRACE_FIELD_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'float'],
  counts: [3, 'buffer-read'],
  pixels: [4, 'buffer-read'],
  ray: [5, 'uint'],
  radiance: [6, { store: F.trace }],
  hit: [7, { store: F.hit, access: 'read-write' }],
  bounceGrid: [8, 'uniform'],
  lights: [10, 'buffer-read'],
})
/** The atlas of the cascades' probes of the field trace. */
export const TRACE_FIELD_PROBES = 9
export const traceFieldEntries = () => [
  ...TRACE_FIELD_BINDINGS.entries,
  atlasEntry(TRACE_FIELD_PROBES),
]

const T = TRACE_FIELD_BINDINGS.at

/**
 * THE FIELD'S ANSWER TO A PROBE'S RAY, for every ray the screen did not answer: the far field, as the world's probes hold it,
 * blended once for the probe (`spFar`) and read along each ray: the radiance the cascades' probes round the probe's point give
 * along the ray's direction, as far as they answer, the sky and the surroundings the rest; the ray's distance, the probes'
 * mean distance along it where they answered, the scene's limit where they did not (the spatial filter weighs a neighbour's
 * light by the angle its hit makes: a far answer is a far hit). The scene stage after it takes the rays its walk answers
 * from this radiance, in place. A ray the screen answered keeps its radiance and its end.
 */
const SP_TRACE_FIELD = wgslBlock(
  'SP_TRACE_FIELD',
  [packLight],
  `@group(0) @binding(${T.radiance}) var radianceOut:texture_storage_2d<${F.trace},write>;
@group(0) @binding(${T.hit}) var hitIo:texture_storage_2d<${F.hit},read_write>;
@group(0) @binding(${T.lights}) var<storage,read> directLights:DirectLights;
@compute @workgroup_size(SP_TRACE,SP_TRACE)
fn traceField(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let atlas=group.xy;
 let probe=spProbeOrDead(atlas);
 let live=probe.depth>0.0;
 if(live&&spFlag(SP_FLAG_FIELD)){spFarGather(probe.P,probe.N,lane);}
 workgroupBarrier();
 let t=vec2u(lane%SP_TRACE,lane/SP_TRACE);
 let at=vec2i(atlas*SP_TRACE+t);
 if(!live||spHitIs(textureLoad(hitIo,at).r)){return;}
 let d=spRayDirection(atlas,t,spIndexOf(atlas));
 textureStore(radianceOut,at,vec4u(packLight(spFarRadiance(d)),0u,0u,0u));
 textureStore(hitIo,at,vec4u(spHitWord(spFarDistance(d),false,false),0u,0u,0u));
}`,
)

/** The field trace's program over `side × side` rays a probe and `samples` of a tile. */
export const traceFieldShader = (side: number, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(T.params)}
${wgslConsts({ SP_TRACE: side })}`,
    [
      DIRECT_LIGHT_WGSL,
      bounceBindingsWgsl(0, T.bounceGrid, TRACE_FIELD_PROBES),
      spCommon(samples),
      spProbes(T.info, T.normal, T.counts),
      spFar,
      spRays(T.ray, T.pixels),
      SP_TRACE_FIELD,
    ],
  )
