import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { computeStorageTextureEntry } from '../../gpu/core/computeBindings.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { surfaceHitLayoutEntries } from '../surfaceCache/hitWgsl.ts'
import { atlasEntry } from '../bounce/atlas.ts'
import { bounceBindingsWgsl } from '../bounce/gridWgsl.ts'
import { spCacheRead } from '../bounce/screen/cacheReadWgsl.ts'
import { spCommon, spParams } from '../bounce/screen/commonWgsl.ts'
import { spReach } from '../bounce/screen/probesWgsl.ts'
import { bindingTable } from '../bounce/screen/screenProbeLayout.ts'
import { SP_MARCH, TRACE_SCENE_HIT } from '../bounce/screen/traceSceneWgsl.ts'
import { GI_QUANTIZE_WGSL, GI_VISIBLE_WGSL } from './frameWgsl.ts'
import {
  TRANSLUCENCY_GI_FORMAT,
  TRANSLUCENCY_GI_GROUP,
  TRANSLUCENCY_GI_SLOT_SIDE,
} from './layout.ts'

/** The trace's bindings in group 0, numbered as the screen probes' scene stage numbers what it shares (the parameters, the cascades, the
 *  lights, the blue noise, the radiance cache's maps from 18, the distance field and surface cache from `TRACE_SCENE_HIT`): the
 *  screen probes' parameters (`sp`), this volume's frame, the cones' light written, the cascades' uniform and atlas. */
export const TRACE_GI_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  frame: [1, 'uniform'],
  bounceGrid: [8, 'uniform'],
  lights: [10, 'buffer-read'],
  blue: [17, 'float'],
  cacheFinal: [18, 'uint'],
  cacheRaw: [19, 'uint'],
  cacheSky: [20, 'float'],
  cacheTags: [21, 'buffer-read'],
})
/** The cones' light written, the cascades' atlas. */
export const TRACE_GI_LIGHT = 2
export const TRACE_GI_PROBES = 9
/** The layout of the trace's group 0. */
export const traceGiEntries = () => [
  ...TRACE_GI_BINDINGS.entries,
  computeStorageTextureEntry(TRACE_GI_LIGHT, TRANSLUCENCY_GI_FORMAT, 'write-only', '3d'),
  atlasEntry(TRACE_GI_PROBES),
  ...surfaceHitLayoutEntries(TRACE_SCENE_HIT),
]

const C = TRACE_GI_BINDINGS.at

/**
 * WHERE A CELL'S POINT IS TRACED FROM (`giTracePoint`): the cell's point at the fraction of it the image's jitter picks, moved forward when
 * the depth is just behind it so that the march does not start inside a surface: where the depth at the point's pixel lies within
 * `gi.depth.y` slices behind the point once the cell is held `gi.depth.x` slices in front of the depth, the point moves forward by what
 * it lacks (a negative `gi.depth.x` asks none). The point's pixel is the cell's own point of the image (`giCellUv`, the point lies on the ray through it)
 * shifted by the jitter the depth was drawn with (`reflectionView.jitter`): no matrix, so no large term far from the origin.
 */
const GI_TRACE_POINT_WGSL = wgslBlock(
  'GI_TRACE_POINT_WGSL',
  [],
  `fn giTracePoint(cell:vec3u)->vec3f{
 var offset=gi.jitter.xyz;
 if(gi.depth.x>=0.0){
  let pixel=giCellUv(vec3f(cell),offset)+reflectionView.jitter.xy*vec2f(0.5,-0.5);
  let z=hizOpaqueDepth(vec2i(pixel*view.viewport.xy));
  if(z>0.0){
   let wanted=giSliceOfDepth(surfaceLinearDepth(worldAt(floor(pixel*view.viewport.xy)+vec2f(0.5),z)))-gi.depth.x;
   let gap=wanted-(f32(cell.z)+offset.z);
   if(gap<0.0&&-gap<gi.depth.y){offset.z+=gap;}
  }
 }
 return giCellPoint(vec3f(cell),offset);
}`,
)

/**
 * THE LIGHT ALONG ONE CONE (`giCone`) of the cell in hand, from its point `giOrigin` along `d`: the march through the global distance field
 * from the cell's point itself (no bias off a surface, no dither: the point is a cell's, not a surface's; `spMarchRay`) to where the
 * radiance cache is trusted (`giReach`: `spLocalReachBiased`, the cascade `gi.temporal.w` coarser than the one that covers the point), the
 * surface cache's light at a hit; for a ray the march leaves — or where it is off — the radiance cache's light along it, interpolated between
 * the eight probes round the point (`spFarOf`), the sky where the cache covers none. The cone is the width of a texel of the octahedron of
 * `gi.trace.x` texels a side. `giCellSetup` is what the cell's cones share, done once for them: where they start, how far they march and
 * the eight probes round the start.
 */
const GI_CONE_WGSL = wgslBlock(
  'GI_CONE_WGSL',
  [SP_MARCH],
  `var<private> giOrigin:vec3f;
var<private> giReach:f32;
fn giCellSetup(cell:vec3u){
 let bias=u32(gi.temporal.w);
 let cached=gi.spatial.w!=0.0;
 giOrigin=giTracePoint(cell);
 if(cached){spCacheGatherOwnBiased(giOrigin,bias);}
 giReach=select(spMaxTrace(),spLocalReachBiased(giOrigin,bias),cached);
}
fn giCone(d:vec3f)->vec3f{
 let cached=gi.spatial.w!=0.0;
 var light=vec3f(0.0);
 var hit=false;
 if(gi.depth.w!=0.0&&spFlag(SP_FLAG_SCENE_TRACES)){
  let marched=spMarchRay(giOrigin,d,0.0,giReach,gi.trace.x,false,vec2u(0u));
  light=marched.lighting;
  hit=marched.hit;
 }
 if(!hit&&cached){light+=spFarOf(giOrigin,d,gi.trace.x).radiance;}
 else if(!hit){light+=reflectionEnvironment(d,0.0);}
 return light;
}`,
)

/**
 * WHAT THE CELLS OF A WORKGROUP SHARE (`GI_SHARED_WGSL`): a workgroup traces a block of `TRANSLUCENCY_GI_GROUP` cone texels a side, which
 * touches at most `TRANSLUCENCY_GI_SLOT_SIDE` cells a side (`giSlotSide`), each with the setup its cones have in common — whether it is
 * seen, where its cones start, how far they march, the eight probes round the start (`CacheGathered`, copied whole) and the noise —, made once by a lane
 * of the workgroup (`giCellStore`) and read by the threads of the cell's cones (`giCellLoad`) into the private state `giCone` reads.
 */
const GI_SHARED_WGSL = wgslBlock(
  'GI_SHARED_WGSL',
  [GI_CONE_WGSL],
  `const GI_SLOTS:u32=${TRANSLUCENCY_GI_SLOT_SIDE * TRANSLUCENCY_GI_SLOT_SIDE}u;
var<workgroup> giSeen:array<u32,GI_SLOTS>;
var<workgroup> giNoise:array<vec2f,GI_SLOTS>;
var<workgroup> giStartOf:array<vec3f,GI_SLOTS>;
var<workgroup> giReachOf:array<f32,GI_SLOTS>;
var<workgroup> giCacheOf:array<CacheGathered,GI_SLOTS>;
fn giCellNoise(cell:vec3u)->vec2f{return blueNoiseVec2(cell.xy,u32(max(gi.jitter.w,0.0)));}
fn giCellStore(slot:u32){
 giStartOf[slot]=giOrigin;
 giReachOf[slot]=giReach;
 giCacheOf[slot]=cacheNow;
}
fn giCellLoad(slot:u32){
 giOrigin=giStartOf[slot];
 giReach=giReachOf[slot];
 cacheNow=giCacheOf[slot];
}`,
)

/**
 * THE TRACE, a thread a cone: the workgroup covers a block of `TRANSLUCENCY_GI_GROUP` texels a side of the cones' texture, as
 * the cones of a cell are `gi.trace.x` squared texels side by side. Where a cell holds more than one cone, a lane of the workgroup finds
 * what the cones of a cell share (`giCellSetup`; a cell not seen, `giVisible`, writes black) once, for the block's cells in turn, and the threads read it
 * after the barrier (`GI_SHARED_WGSL`); where a cell holds one, the thread finds its own. The direction of a cone is the equal-area
 * octahedron's texel, jittered within it by the blue noise of the cell's column and the turn of the image (`gi.jitter.w`), the light its
 * march and the radiance cache give (`giCone`), multiplied by the pre-exposure, held to `gi.trace.y` (the ray's largest channel scaled
 * down to it) and written to the format's precision (`giQuantize`, the draw of the written texel). The barrier is reached by every thread,
 * the ones beyond the grid included.
 */
const GI_TRACE_ENTRY = wgslBlock(
  'GI_TRACE_ENTRY',
  [GI_TRACE_POINT_WGSL, GI_SHARED_WGSL, GI_QUANTIZE_WGSL, DIRECT_LIGHT_WGSL],
  `@group(0) @binding(${TRACE_GI_LIGHT}) var coneLight:texture_storage_3d<${TRANSLUCENCY_GI_FORMAT},write>;
@group(0) @binding(${C.lights}) var<storage,read> directLights:DirectLights;
@compute @workgroup_size(${TRANSLUCENCY_GI_GROUP},${TRANSLUCENCY_GI_GROUP},1)
fn traceCones(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 let res=u32(gi.trace.x);
 let cell=vec3u(id.xy/res,id.z);
 let inside=all(cell<gi.grid.xyz);
 var seen=false;
 var noise=vec2f(0.0);
 if(res>1u){
  let first=block.xy*${TRANSLUCENCY_GI_GROUP}u/res;
  if(lane<GI_SLOTS){
   let mine=vec3u(first+vec2u(lane%${TRANSLUCENCY_GI_SLOT_SIDE}u,lane/${TRANSLUCENCY_GI_SLOT_SIDE}u),id.z);
   let here=all(mine<gi.grid.xyz)&&giVisible(mine);
   giSeen[lane]=select(0u,1u,here);
   if(here){giCellSetup(mine);giCellStore(lane);giNoise[lane]=giCellNoise(mine);}
  }
  workgroupBarrier();
  if(inside){
   let slot=(cell.y-first.y)*${TRANSLUCENCY_GI_SLOT_SIDE}u+cell.x-first.x;
   seen=giSeen[slot]!=0u;
   if(seen){giCellLoad(slot);noise=giNoise[slot];}
  }
 }else if(inside){
  seen=giVisible(cell);
  if(seen){giCellSetup(cell);noise=giCellNoise(cell);}
 }
 if(!inside){return;}
 var radiance=vec3f(0.0);
 if(seen){
  let cone=vec2f(id.xy-cell.xy*res);
  radiance=giCone(equalAreaDecode((cone+noise)/f32(res)))*gi.trace.z;
  let most=max(radiance.x,max(radiance.y,radiance.z));
  if(most>gi.trace.y){radiance*=gi.trace.y/most;}
 }
 textureStore(coneLight,id,vec4f(giQuantize(radiance,id.xy,id.z),0.0));
}`,
)

/** The trace's program over cones of `side` texels a side an octahedron (the screen probes' kernels' constants, a cone as wide as a texel). */
export const TRACE_GI_PROGRAM = wgslProgram(
  `${spParams(C.params)}
@group(0) @binding(${C.frame}) var<uniform> gi:TranslucencyGiFrame;`,
  [
    spCommon([1, 1]),
    bounceBindingsWgsl(0, C.bounceGrid, TRACE_GI_PROBES),
    spReach,
    spCacheRead(C.cacheFinal, C.cacheRaw, C.cacheSky, C.cacheTags, 'private'),
    blueNoiseWgsl(0, C.blue),
    GI_VISIBLE_WGSL,
    GI_TRACE_ENTRY,
  ],
)
