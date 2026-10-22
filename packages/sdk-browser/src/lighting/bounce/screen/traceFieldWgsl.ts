import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { atlasEntry } from '../atlas.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spCacheRead } from './cacheReadWgsl.ts'
import { spProbes } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'
import { spRays } from './traceWgsl.ts'

/** The field trace's bindings: the probes' records and pixels, the ray words, the radiance written and the ends read and
 *  written in place, the cascades, the light buffer (the sky it holds), the radiance cache's maps and their tags. */
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
  blue: [11, 'float'],
  cacheFinal: [12, 'uint'],
  cacheRaw: [13, 'uint'],
  cacheSky: [14, 'float'],
  cacheTags: [15, 'buffer-read'],
})
/** The atlas of the cascades' probes of the field trace. */
export const TRACE_FIELD_PROBES = 9
export const traceFieldEntries = () => [
  ...TRACE_FIELD_BINDINGS.entries,
  atlasEntry(TRACE_FIELD_PROBES),
]

const T = TRACE_FIELD_BINDINGS.at

/**
 * WHAT LIES PAST THE SCREEN AND THE NEAR SCENE, for every ray the screen did not answer: the radiance cache (`spFarOf`), read for
 * the probe's point once (`spCacheGather`) — the eight probes of the cell round it — and along each ray (`spCacheSample`):
 * the light the probes' maps hold along the ray's direction, with the distance their rays went; the environment's, at the ray's
 * reach, where the cache covers no point of the probe. The scene stage after it takes the rays its walk answers from this
 * radiance, in place. A ray the screen answered keeps its radiance and its end.
 */
const SP_TRACE_FIELD = wgslBlock(
  'SP_TRACE_FIELD',
  [packLight],
  `@group(0) @binding(${T.radiance}) var radianceOut:texture_storage_2d<${F.trace},write>;
@group(0) @binding(${T.hit}) var hitIo:texture_storage_2d<${F.hit},read_write>;
@group(0) @binding(${T.lights}) var<storage,read> directLights:DirectLights;
/** The texels a side of the grid the ray of trace texel \`t\` of the probe at \`atlas\` is a texel of (the grid \`spRayDirection\` reads it from): the
 *  width of its cone. */
fn spRayCone(atlas:vec2u,t:vec2u)->f32{
 if(!spFlag(SP_FLAG_IMPORTANCE)){return f32(SP_TRACE);}
 return f32(spRayMip(spRayLevel(textureLoad(rayWords,vec2i(atlas*SP_TRACE+t),0).r),SP_TRACE));
}
@compute @workgroup_size(SP_TRACE,SP_TRACE)
fn traceField(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let atlas=group.xy;
 let probe=spProbeOrDead(atlas);
 let live=probe.depth>0.0;
 if(live&&spFlag(SP_FLAG_CACHE)){spCacheGather(probe.P,lane);}
 workgroupBarrier();
 let t=vec2u(lane%SP_TRACE,lane/SP_TRACE);
 let at=vec2i(atlas*SP_TRACE+t);
 if(!live||spHitIs(textureLoad(hitIo,at).r)){return;}
 let far=spFarOf(probe.P,spRayDirection(atlas,t,spIndexOf(atlas)),spRayCone(atlas,t));
 textureStore(radianceOut,at,vec4u(packLight(far.radiance),0u,0u,0u));
 textureStore(hitIo,at,vec4u(spHitWord(far.distance,false,false),0u,0u,0u));
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
      spCacheRead(T.cacheFinal, T.cacheRaw, T.cacheSky, T.cacheTags),
      spRays(T.ray, T.pixels, T.blue),
      SP_TRACE_FIELD,
    ],
  )
