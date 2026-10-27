import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { pixelToNdc, transformHomogeneousPoint } from '../../../math/src/wgsl/projection.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { HAIR_IMAGE_WGSL } from './imageBlock.ts'
import { HAIR_MACRO_GROUP_MASK, HAIR_MACRO_GROUP_SHIFT } from './materialMath.ts'
import { HAIR_COVERAGE_WGSL } from './ribbonWgsl.ts'
import { hairListedPixel } from './tilesWgsl.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COORD_MASK,
  HAIR_COVERAGE_BITS,
  HAIR_DEPTH_SCALE,
  HAIR_ID_BITS,
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_COUNTERS,
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_GROUP_SIZE,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
  HAIR_TILE_LISTS,
  HAIR_TILE_SIZE,
} from './visibilityMath.ts'

/**
 * THE MATERIAL OF THE COMPACTED SAMPLES: for each sample of the instance bound in group 0, its
 * material, five words (`packHairSample`, `materialMath.ts`) in `nodeData`. A thread is a stored
 * sample; it leaves unless its identifier names this instance. The sample's place on its strand is
 * found as the visibility's pixel centre at the sample's depth, in the world, projected onto the
 * segment: `u`, the share of the segment from its first control point, which its tangent is blended by.
 * Its colour and roughness are the default strand material's (`inst.base`): no material a groom names
 * reads the strands' attributes. The coverage is the visibility's share of the pixel's samples the
 * sample holds, or, where the samples of a pixel are sorted by depth (`view.sort`), the share of a pixel
 * the strand's radius covers (`HAIR_COVERAGE_WGSL`, one sample a pixel and no coverage scale: the
 * groom's is 1).
 */
export const MATERIAL_WGSL = wgslProgram(
  `@group(1) @binding(1) var<storage,read> nodeVis:array<vec2u>;
@group(1) @binding(2) var<storage,read> nodeCoord:array<u32>;
@group(1) @binding(3) var<storage,read> nodeCounter:array<u32,${HAIR_NODE_COUNTERS}>;
@group(1) @binding(4) var<storage,read_write> nodeData:array<u32>;
// A share from 0 to 1 as the byte the words hold it in.
fn unitByte(x:f32)->u32{return u32(saturate(x)*255.0);}
@compute @workgroup_size(${HAIR_NODE_GROUP_SIZE}) fn hairMaterial(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let node=flatIndex(id,groups,${HAIR_NODE_GROUP_SIZE}u);
 if(node>=nodeCounter[${HAIR_NODE_COUNTER_STORED}]){return;}
 let vis=nodeVis[node];
 if((vis.y>>${HAIR_ID_BITS}u)!=inst.ids.x){return;}
 let point=vis.y&${2 ** HAIR_ID_BITS - 1}u;
 let depth=f32(vis.x>>${HAIR_COVERAGE_BITS}u)/${HAIR_DEPTH_SCALE}.0;
 let at=nodeCoord[node];
 let pixel=vec2f(f32(at&${HAIR_COORD_MASK}u),f32(at>>${HAIR_COORD_BITS}u))+vec2f(0.5);
 let h=transformHomogeneousPoint(view.inverseViewProj,vec3f(pixelToNdc(pixel,view.size),depth));
 let world=h.xyz/h.w;
 let first=spineAt(point);
 let second=spineAt(point+1u);
 let along=second.position-first.position;
 let alongSquared=dot(along,along);
 let u=select(0.0,saturate(dot(world-first.position,along)/alongSquared),alongSquared>0.0);
 let tangent=normalize(mix(tangentAt(point),tangentAt(point+1u),u));
 var coverage=vis.x&0xffu;
 if(view.sort.x>0.5){coverage=min(u32(strandCoverage(mix(first.radius,second.radius,u),h.w)*255.0),255u);}
 let t=saturate(tangent*0.5+vec3f(0.5));
 let rgb=sqrt(inst.base.xyz);
 let o=node*${HAIR_NODE_DATA_WORDS}u;
 nodeData[o]=bitcast<u32>(depth);
 nodeData[o+1u]=point|((inst.flags.w&${HAIR_MACRO_GROUP_MASK}u)<<${HAIR_MACRO_GROUP_SHIFT}u);
 nodeData[o+2u]=u32(t.x*255.0)|(u32(t.y*255.0)<<8u)|(u32(t.z*255.0)<<16u)|(coverage<<24u);
 nodeData[o+3u]=unitByte(rgb.x)|(unitByte(rgb.y)<<8u)|(unitByte(rgb.z)<<16u)|(unitByte(inst.base.w)<<24u);
 nodeData[o+4u]=unitByte(inst.shade.x)|(unitByte(inst.shade.y)<<8u)|((inst.flags.x&0xffu)<<16u)|((inst.flags.z&7u)<<24u);
}`,
  [HAIR_COVERAGE_WGSL, pixelToNdc, transformHomogeneousPoint, FLAT_INDEX_WGSL],
)

/**
 * THE COVERAGE OF A SORTED PIXEL (`sortByDepth`): the samples of a pixel go from the nearest, each
 * one's coverage the share of the light the ones before it let through (the product of what they
 * let through, `1 - coverage`), times its own, normalised by the sum of the pixel's, a whole number
 * of 256ths. A thread is a pixel of the tiles with strands; a pixel whose samples cover nothing keeps
 * the coverage it has.
 */
export const SAMPLE_COVERAGE_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> counts:array<u32,${HAIR_TILE_LISTS}>;
@group(0) @binding(2) var<storage,read> tiles:array<u32>;
@group(0) @binding(3) var nodeIndex:texture_2d<u32>;
@group(0) @binding(4) var<storage,read_write> nodeData:array<u32>;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairSampleCoverage(@builtin(workgroup_id) block:vec3u,@builtin(num_workgroups) blocks:vec3u,@builtin(local_invocation_id) local:vec3u){
 let at=hairListedPixel(flatIndex(block,blocks,1u),local.xy);
 if(!at.ok){return;}
 let pixel=at.pixel;
 let desc=textureLoad(nodeIndex,vec2i(pixel),0).x;
 let first=desc&${HAIR_NODE_OFFSET_MASK}u;
 let count=desc>>${HAIR_NODE_OFFSET_BITS}u;
 var sorted:array<f32,8>;
 var through=1.0;
 var total=0.0;
 for(var i=0u;i<count;i++){
  let coverage=f32(nodeData[(first+i)*${HAIR_NODE_DATA_WORDS}u+2u]>>24u)/255.0;
  sorted[i]=through*coverage;
  through*=1.0-coverage;
  total+=sorted[i];
 }
 if(!(total>0.0)){return;}
 for(var i=0u;i<count;i++){
  let at=(first+i)*${HAIR_NODE_DATA_WORDS}u+2u;
  let share=min(u32(sorted[i]/total*256.0),255u);
  nodeData[at]=(nodeData[at]&0x00ffffffu)|(share<<24u);
 }
}`,
  [HAIR_IMAGE_WGSL, hairListedPixel, FLAT_INDEX_WGSL],
)
