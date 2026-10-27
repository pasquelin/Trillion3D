import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { SP_QUANTIZE } from './gatherWgsl.ts'
import { spProbes } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The spatial filter's bindings: the probes' records and pixels, the probes flagged as disoccluded, the
 *  gathered radiance read and the one written, the share of each probe's rays that move, the rank of the pass (its first word). */
export const SPATIAL_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  info: [1, 'float'],
  normal: [2, 'uint'],
  counts: [3, 'buffer-read'],
  pixels: [4, 'buffer-read'],
  disocclusion: [5, 'buffer-read'],
  gatherIn: [6, 'float'],
  gatherOut: [7, { store: F.gather }],
  moving: [8, 'buffer-read'],
  blue: [9, 'float'],
  pass: [10, 'uniform'],
  aoIn: [11, 'float'],
  aoOut: [12, { store: F.extraAo }],
})

const B = SPATIAL_BINDINGS.at

/** The layout of the spatial filter's group: the extra ambient occlusion it reads and writes only where the probes keep one. */
export const spatialEntries = (extraAo: boolean) =>
  SPATIAL_BINDINGS.entries.filter(
    (entry) => extraAo || (entry.binding !== B.aoIn && entry.binding !== B.aoOut),
  )

/**
 * The neighbours of a probe the filter reads, in tiles from its own: the four beside it, then the eight a probe that moves
 * takes besides — the four diagonal and the four two tiles off.
 */
const SP_NEIGHBOURS = wgslBlock(
  'SP_NEIGHBOURS',
  [],
  `var<private> SP_NEIGHBOUR_OFFSETS:array<vec2i,12>=array<vec2i,12>(
 vec2i(-1,0),vec2i(1,0),vec2i(0,-1),vec2i(0,1),
 vec2i(-2,0),vec2i(2,0),vec2i(0,-2),vec2i(0,2),vec2i(-1,1),vec2i(1,1),vec2i(-1,-1),vec2i(1,-1));`,
)

/**
 * THE SPATIAL FILTER, one pass of it: each texel of a probe's octahedron averages the same texel of the four
 * probes next to it — the uniform probes of the tiles at its left, right, above and below — and its
 * own. A neighbour weighs by how near its depth the probe's lies (`exp2(-scale · (Δdepth / depth)²)`, so
 * that a probe on another surface weighs nothing) and by the angle its ray makes with the probe's: the neighbour's
 * hit, from the neighbour, along the texel's direction, seen from the probe, against the direction itself
 * — one minus the angle over `screenProbeSpatialFilterMaxHitAngle` —, the neighbour's distance held to the probe's own,
 * so that a contact shadow keeps its edge and a long distance is not mistaken for a wall. A probe flagged as
 * disoccluded (`screenData`) takes its neighbours' light whatever the angle: what its pixels hold of
 * history is too short to wait for. A probe over a hundredth of its rays moving (`probeMoving`) filters
 * strongly: eight probes more and no angle test, its history being short too. A texel that received no ray (a distance
 * of `-1`) gives none and takes none; the distance is the composite's code (`spHitCode`), carried through the passes. The light a pass writes is
 * as an 11-11-10 target holds it (`spQuantize`), dithered by the blue noise of the texel at the frame, the pass's rank and eleven. With the extra
 * ambient occlusion the same weights average it (`aoIn`, `aoOut`): `ao` is the weighted occlusion of the neighbour, its weight in `w` of the
 * light's.
 */
const spSpatial = (extraAo: boolean) =>
  wgslBlock(
    `SP_SPATIAL(${extraAo})`,
    [SP_NEIGHBOURS, SP_QUANTIZE],
    `@group(0) @binding(${B.pixels}) var<storage,read> probePixels:array<u32>;
@group(0) @binding(${B.disocclusion}) var<storage,read> disocclusion:array<u32>;
@group(0) @binding(${B.moving}) var<storage,read> probeMoving:array<f32>;
@group(0) @binding(${B.gatherIn}) var gatherIn:texture_2d<f32>;
@group(0) @binding(${B.gatherOut}) var gatherOut:texture_storage_2d<${F.gather},write>;
@group(0) @binding(${B.pass}) var<uniform> spatialPass:vec4u;
${
  extraAo
    ? `@group(0) @binding(${B.aoIn}) var aoIn:texture_2d<f32>;
@group(0) @binding(${B.aoOut}) var aoOut:texture_storage_2d<${F.extraAo},write>;`
    : ''
}
/** The weight of a neighbour's probe by how near its depth lies to the probe's: nothing for a probe on no lit surface. */
fn spFilterPosition(neighbour:f32,depth:f32)->f32{
 if(neighbour<0.0){return 0.0;}
 let relative=abs(neighbour-depth)/depth;
 return exp2(-sp.spatial.x*relative*relative);
}
/** What a neighbour gives a texel: its weighted light, its weight in \`light.w\`, and its weighted extra ambient occlusion. */
struct SpNeighbour{light:vec4f,ao:f32,}
/** The weighted light of texel \`t\` of the probe of tile \`tile\` (\`hit\` the probe's own hit distance there), none for a neighbour that gives none. */
fn spGatherNeighbour(tile:vec2i,t:vec2u,P:vec3f,direction:vec3f,depth:f32,hit:f32,relax:bool)->SpNeighbour{
 let none=SpNeighbour(vec4f(0.0),0.0);
 if(any(tile<vec2i(0))||any(tile>=vec2i(sp.grid.xy))){return none;}
 let atlas=vec2u(tile);
 let probe=spReadProbe(atlas);
 let position=spFilterPosition(probe.depth,depth);
 if(position<=0.0){return none;}
 let kept=textureLoad(gatherIn,vec2i(atlas*SP_GATHER+t),0);
 let keptHit=spHitFromCode(kept.w);
 if(keptHit<0.0){return none;}
 var angleWeight=1.0;
 if(!relax){
  let reach=select(keptHit,min(keptHit,hit),hit>=0.0);
  let toHit=probe.P+direction*reach-P;
  let angle=acos(clamp(dot(toHit,direction)/max(length(toHit),1e-6),-1.0,1.0));
  angleWeight=1.0-saturate(angle/sp.spatial.y);
 }
 let weight=position*angleWeight;
 ${extraAo ? 'let ao=textureLoad(aoIn,vec2i(atlas*SP_GATHER+t),0).r*weight;' : 'let ao=0.0;'}
 return SpNeighbour(vec4f(kept.rgb*weight,weight),ao);
}
@compute @workgroup_size(8,8)
fn spatialFilter(@builtin(global_invocation_id) id:vec3u){
 let atlas=id.xy/SP_GATHER;
 if(atlas.x>=sp.grid.x||atlas.y>=sp.grid.z){return;}
 let t=id.xy%SP_GATHER;
 let index=spIndexOf(atlas);
 let own=textureLoad(gatherIn,vec2i(id.xy),0);
 let probe=spProbeOrDead(atlas);
 var out=vec4f(0.0,0.0,0.0,own.w);
 var occlusion=1.0;
 let ownHit=spHitFromCode(own.w);
 if(probe.depth>0.0){
  let tile=spProbeTile(probePixels[index]);
  let direction=equalAreaDecode((vec2f(t)+blueNoiseVec2(tile,sp.mode.w))/f32(SP_GATHER));
  let moving=probeMoving[index]>0.01;
  let relax=disocclusion[index]!=0u||moving;
  var total=select(vec4f(0.0),vec4f(own.rgb,1.0),ownHit>=0.0);
  var totalAo=${extraAo ? 'select(0.0,textureLoad(aoIn,vec2i(id.xy),0).r,ownHit>=0.0)' : '0.0'};
  for(var k=0u;k<select(4u,12u,moving);k++){
   let near=spGatherNeighbour(vec2i(tile)+SP_NEIGHBOUR_OFFSETS[k],t,probe.P,direction,probe.depth,ownHit,relax);
   total+=near.light;
   totalAo+=near.ao;
  }
  let dither=blueNoiseScalar(id.xy,sp.size.w%SP_TILE_JITTERS+spatialPass.x+11u);
  out=vec4f(spQuantize(select(vec3f(0.0),total.rgb/total.w,total.w>0.0),dither),own.w);
  occlusion=select(0.0,totalAo/total.w,total.w>0.0);
 }
 textureStore(gatherOut,vec2i(id.xy),out);
${extraAo ? ' textureStore(aoOut,vec2i(id.xy),vec4f(spExtraAoStored(occlusion),0.0,0.0,0.0));' : ''}
}`,
  )

/** The spatial filter's program over `gather × gather` texels a probe and `samples` of a tile; with the extra ambient occlusion where `extraAo`. */
export const spatialFilterShader = (
  gather: number,
  samples: readonly [number, number],
  extraAo = false,
) =>
  wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_GATHER: gather })}`,
    [
      spCommon(samples),
      spProbes(B.info, B.normal, B.counts),
      blueNoiseWgsl(0, B.blue),
      spSpatial(extraAo),
    ],
  )
