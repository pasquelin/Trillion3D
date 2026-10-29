import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { equalAreaDecode, octWrapBorder } from '../../../../../math/src/wgsl/octahedral.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import {
  WORD_LIGHT_FORMAT,
  lightAtlasSampleType,
  lightAtlasScalar,
  lightOfTexel,
  lightReadDeps,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'
import { cacheKernelEntries } from '../cache/cacheBindings.ts'
import { CACHE_TILE_SIDE, RADIANCE_CACHE_PARAMS } from '../cache/cacheLayout.ts'
import { CACHE_WORDS_WGSL } from '../cache/cacheWordsWgsl.ts'
import { rawWordChannel } from '../cache/cacheRawWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { BOUNCE_CM_WGSL } from '../tracedHitWgsl.ts'
import { globalDistanceFieldReadWgsl } from '../../distanceField/globalReadWgsl.ts'
import { globalReadLayoutEntries } from '../../distanceField/view.ts'

/** The format of the occlusion maps the field keeps for each probe beside the cache's own: the mean distance a ray of the probe goes and the mean of its square. */
export const FIELD_OCCLUSION_FORMAT = 'rg32float' as const

/** The format of the irradiance maps: a colour in half floats, in single floats where the lighting data format is (the light kept as precisely as the cache's maps are). */
export const irradianceFieldFormat = (light: LightAtlasFormat): GPUTextureFormat =>
  light === 'rgba32float' ? 'rgba32float' : 'rgba16float'

/** The bindings of the kernel that makes the irradiance maps (`IRRADIANCE_PROGRAM`): the levels' uniform, the cell table, the queue, the cache's parameters, the final atlas it reads and the irradiance atlas it writes. */
export const IRRADIANCE_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  final: 4,
  irradiance: 5,
} as const

/** The bindings of the kernel that makes the occlusion maps (`OCCLUSION_PROGRAM`): as the irradiance's, the raw atlas (which holds the distances) read and the occlusion atlas written. */
export const OCCLUSION_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  raw: 4,
  occlusion: 5,
  /** Whether each probe stands outside every surface (`RWProbeValid`), a word a probe by its slot. */
  valid: 6,
  /** The global distance field's six bindings, which the validity reads. */
  field: 7,
} as const

/** The layout of the irradiance kernel. */
export const irradianceEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => {
  const B = IRRADIANCE_BINDINGS
  return [
    ...cacheKernelEntries(B),
    computeTextureEntry(B.final, lightAtlasSampleType(light)),
    computeStorageTextureEntry(B.irradiance, irradianceFieldFormat(light)),
  ]
}

/** The layout of the occlusion kernel. */
export const occlusionEntries = () => {
  const B = OCCLUSION_BINDINGS
  return [
    ...cacheKernelEntries(B),
    computeTextureEntry(B.raw, 'uint'),
    computeStorageTextureEntry(B.occlusion, FIELD_OCCLUSION_FORMAT),
    computeBufferEntry(B.valid, 'storage'),
    ...globalReadLayoutEntries(B.field),
  ]
}

/** The texels a side of the radiance a probe's irradiance is summed from (the reference's `DOWNSAMPLED_RADIANCE_SIZE`). */
const DOWNSAMPLED = 8

/** The border all round a probe's irradiance and occlusion maps, so that a bilinear read at the edge needs nothing beyond them. */
export const FIELD_MAP_BORDER = 1

/** The declarations of the irradiance maps' kernel: the cache's parameters, the queue, the final radiance map, the irradiance atlas and the constants. */
const irradianceDeclarations = (
  resolution: number,
  light: LightAtlasFormat,
) => `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${IRRADIANCE_BINDINGS.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${IRRADIANCE_BINDINGS.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${IRRADIANCE_BINDINGS.final}) var finalIn:texture_2d<${lightAtlasScalar(light)}>;
@group(0) @binding(${IRRADIANCE_BINDINGS.irradiance}) var irradianceOut:texture_storage_2d<${irradianceFieldFormat(light)},write>;
${wgslConsts({ CACHE_TILE_SIDE, FIELD_DOWNSAMPLED: DOWNSAMPLED, FIELD_IRRADIANCE: resolution, FIELD_BORDER: FIELD_MAP_BORDER })}
var<workgroup> downsampled:array<array<vec3f,FIELD_DOWNSAMPLED>,FIELD_DOWNSAMPLED>;`

/** The kernel: a workgroup a queued probe, its radiance downsampled and its irradiance written texel by texel. */
const irradianceKernel = (
  light: LightAtlasFormat,
) => `@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn irradianceMaps(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 let live=entry<bounce.frame.y&&bounce.counts.w!=0u;
 let queued=queuedProbe(select(0u,entry,live));
 let res=cache.resolution;
 let border=1u<<(cache.mipmaps-1u);
 let first=cacheTileOf(queued.slot,res+2u*border)+vec2u(border);
 let factor=max(res/FIELD_DOWNSAMPLED,1u);
 let local=vec2u(lane%CACHE_TILE_SIDE,lane/CACHE_TILE_SIDE);
 var sum=vec3f(0.0);
 for(var y=0u;y<factor;y++){
  for(var x=0u;x<factor;x++){
   sum+=${lightOfTexel(light, 'textureLoad(finalIn,vec2i(first+local*factor+vec2u(x,y)),0)')};
  }
 }
 downsampled[local.y][local.x]=sum/f32(factor*factor);
 workgroupBarrier();
 if(!(live&&queued.valid)){return;}
 let side=FIELD_IRRADIANCE+2u*FIELD_BORDER;
 let base=cacheTileOf(queued.slot,side);
 for(var dy=local.y;dy<side;dy+=CACHE_TILE_SIDE){
  for(var dx=local.x;dx<side;dx+=CACHE_TILE_SIDE){
   let texel=octWrapBorder(vec2u(dx,dy),side,FIELD_BORDER);
   let direction=equalAreaDecode((vec2f(texel)+vec2f(0.5))/f32(FIELD_IRRADIANCE));
   var total=vec3f(0.0);
   var weight=0.0;
   for(var y=0u;y<FIELD_DOWNSAMPLED;y++){
    for(var x=0u;x<FIELD_DOWNSAMPLED;x++){
     let heard=dot(direction,equalAreaDecode((vec2f(f32(x),f32(y))+vec2f(0.5))/f32(FIELD_DOWNSAMPLED)));
     if(heard>0.0){
      total+=downsampled[y][x]*heard;
      weight+=heard;
     }
    }
   }
   textureStore(irradianceOut,vec2i(base+vec2u(dx,dy)),vec4f(total/max(weight,1e-6),0.0));
  }
 }
}`

/**
 * THE IRRADIANCE MAPS (`irradianceMaps`, `CalculateProbeIrradianceCS`): for every probe the frame queued, a workgroup, the irradiance of each texel of its irradiance map — `resolution` texels a
 * side and a border of one, the border the texel its wrap names (`octWrapBorder`) —: the probe's final radiance map (its first level, past its border), downsampled to 8 × 8 texels by their
 * means, summed over the directions in the hemisphere of the texel's direction, each weighed by its cosine, over the sum of the weights: the cosine-weighted mean radiance, not scaled by pi, as the
 * reference writes it. The result is the texel of the irradiance atlas at the probe's slot (`cacheTileOf`).
 */
export const irradianceProgram = (
  resolution: number,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) =>
  wgslProgram([irradianceDeclarations(resolution, light), irradianceKernel(light)].join('\n'), [
    bounceBindingsWgsl(0, IRRADIANCE_BINDINGS.grid, IRRADIANCE_BINDINGS.table),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    octWrapBorder,
    equalAreaDecode,
    ...lightReadDeps(light),
  ])

/**
 * WHETHER A PROBE STANDS OUTSIDE EVERY SURFACE (`fieldProbeOutside`, the reference's `RWProbeValid` of the software trace, `RadianceCache.usf:1362-1386`): the probe's centre is farther from the nearest surface of the global distance field
 * than half the voxel of the finest clipmap it lies a voxel inside of, times the covered pages' expansion scale (`gdfView.expandCovered`); a probe inside a surface is invalid and its weight is nearly none
 * in the interpolation. With no clipmap in the field the probe is valid.
 */
const PROBE_OUTSIDE_WGSL = wgslBlock(
  'PROBE_OUTSIDE_WGSL',
  [BOUNCE_CM_WGSL, globalDistanceFieldReadWgsl(0, OCCLUSION_BINDINGS.field), QUEUED_PROBE_WGSL],
  `fn fieldProbeOutside(queued:QueuedProbe)->bool{
 if(gdfView.clipmaps==0u){return true;}
 let centre=queuedPosition(queued)*f32(BOUNCE_CM);
 var voxel=0.0;
 for(var clipmap=0u;clipmap<gdfView.clipmaps;clipmap++){
  let box=gdfView.centerExtent[clipmap];
  let extent=box.w*gdfView.texel;
  if(gdfBoxDistanceInside(box.xyz,box.w,centre)>extent){
   voxel=extent;
   break;
  }
 }
 return gdfDistanceToNearestSurface(centre)>voxel*0.5*gdfView.expandCovered;
}`,
)

/**
 * THE OCCLUSION MAPS (`occlusionMaps`, `PrepareProbeOcclusionCS`, the unfiltered path): for every probe the frame queued, a workgroup, a texel of its occlusion map — `resolution` texels a side and a border of
 * one, the border the texel its wrap names — holds the distance the probe's ray in that direction went and its square, `(d, d²)`, the distance of a two-sided surface four times (a ray that met one is
 * not an occluder). The map reads the raw atlas of the probe's rays at the texel in the same direction, whatever the two resolutions are: where they differ the reference writes zero (its own visual assert),
 * the nearest texel is taken here. The probe's validity (its inside a surface, in the reference's software path) is not decided here.
 */
export const occlusionProgram = (resolution: number, light: LightAtlasFormat = WORD_LIGHT_FORMAT) =>
  wgslProgram(
    `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${OCCLUSION_BINDINGS.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${OCCLUSION_BINDINGS.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${OCCLUSION_BINDINGS.raw}) var cacheRaw:texture_2d<u32>;
@group(0) @binding(${OCCLUSION_BINDINGS.occlusion}) var occlusionOut:texture_storage_2d<${FIELD_OCCLUSION_FORMAT},write>;
@group(0) @binding(${OCCLUSION_BINDINGS.valid}) var<storage,read_write> probeValid:array<u32>;
${wgslConsts({ CACHE_TILE_SIDE, FIELD_OCCLUSION: resolution, FIELD_BORDER: FIELD_MAP_BORDER })}
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn occlusionMaps(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 let res=cache.resolution;
 let side=FIELD_OCCLUSION+2u*FIELD_BORDER;
 let raw=cacheTileOf(queued.slot,res);
 let base=cacheTileOf(queued.slot,side);
 let local=vec2u(lane%CACHE_TILE_SIDE,lane/CACHE_TILE_SIDE);
 for(var dy=local.y;dy<side;dy+=CACHE_TILE_SIDE){
  for(var dx=local.x;dx<side;dx+=CACHE_TILE_SIDE){
   let texel=octWrapBorder(vec2u(dx,dy),side,FIELD_BORDER);
   let source=min(texel*res/FIELD_OCCLUSION,vec2u(res-1u));
   let word=textureLoad(cacheRaw,vec2i(raw+source),0).${rawWordChannel(light, 'rg')};
   let distance=cacheDepthOf(word)*select(1.0,4.0,cacheTwoSidedIs(word));
   textureStore(occlusionOut,vec2i(base+vec2u(dx,dy)),vec4f(distance,distance*distance,0.0,0.0));
  }
 }
 if(lane==0u){probeValid[queued.slot]=select(0u,1u,fieldProbeOutside(queued));}
}`,
    [
      bounceBindingsWgsl(0, OCCLUSION_BINDINGS.grid, OCCLUSION_BINDINGS.table),
      QUEUED_PROBE_WGSL,
      CACHE_WORDS_WGSL,
      octWrapBorder,
      PROBE_OUTSIDE_WGSL,
    ],
  )
