import { wgslBlock, wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import {
  RENDER_CURVE_BIN_TILE_SIZE,
  RENDER_CURVE_CLUSTER_HEADER_BYTES,
  RENDER_CURVE_CURVES_PER_CLUSTER,
} from './renderCurveMath.ts'

/** The bytes of the block the curve raster's passes share (`RenderCurveParams`). */
export const RENDER_CURVE_PARAMS_BYTES = 144

/** The words of the counters buffer the passes share: the nearest and furthest depth of the visible clusters (as float bits), the number of visible clusters, the binners' queue, and the allocations of the tile data, the z bins, their segments and the raster work. */
export const RENDER_CURVE_COUNTER = {
  minZ: 0,
  maxZ: 1,
  visibleClusters: 2,
  clusterCount: 3,
  queue: 4,
  tileData: 5,
  zBins: 6,
  zBinSegments: 7,
  rasterWork: 8,
} as const
export const RENDER_CURVE_COUNTER_WORDS = 16

/** The block every pass of the curve raster reads: the translated world to clip transform, the sizes and the limits (`renderCurveCommon`). Bound as `curve`. */
export const RENDER_CURVE_PARAMS_WGSL = wgslStruct(
  'RenderCurveParams',
  [],
  `struct RenderCurveParams{
 toClip:mat4x4f,
 resolution:vec2u,
 binTileRes:vec2u,
 zScale:f32,
 zBias:f32,
 ortho:u32,
 instanceCount:u32,
 numBinners:u32,
 clusterCount:u32,
 clusterStrideWords:u32,
 maxVisibleClusters:u32,
 maxTileAllocCount:u32,
 maxSegmentDataCount:u32,
 maxZBinDataCount:u32,
 maxRasterWorkCount:u32,
 maxZBinSegmentDataCount:u32,
 hzbLevels:u32,
 padA:u32,
 padB:u32,
}`,
)

/** The packing of a bin tile's coordinates in eight bits each, and the pairs of halves. */
export const RENDER_CURVE_TILE_PACK_WGSL = wgslBlock(
  'RENDER_CURVE_TILE_PACK_WGSL',
  [],
  `fn packTile(c:vec2u)->u32{return (c.x&0xFFu)|((c.y&0xFFu)<<8u);}
fn unpackTile(p:u32)->vec2u{return vec2u(p&0xFFu,(p>>8u)&0xFFu);}`,
)

/** The instance record at `index` (`RENDER_CURVE_INSTANCE_WORDS` words, read from the buffer `instances`): its clusters, the box in its space and its transform to the translated world. */
export const RENDER_CURVE_INSTANCE_WGSL = wgslBlock(
  'RENDER_CURVE_INSTANCE_WGSL',
  [],
  `struct CurveInstance{clusterOffset:u32,clusterCount:u32,center:vec3f,extent:vec3f,localToWorld:mat4x4f}
fn loadInstance(index:u32)->CurveInstance{
 let at=index*32u;
 var out:CurveInstance;
 out.clusterOffset=instances[at];
 out.clusterCount=instances[at+1u];
 out.center=vec3f(bitcast<f32>(instances[at+4u]),bitcast<f32>(instances[at+5u]),bitcast<f32>(instances[at+6u]));
 out.extent=vec3f(bitcast<f32>(instances[at+8u]),bitcast<f32>(instances[at+9u]),bitcast<f32>(instances[at+10u]));
 var m:mat4x4f;
 for(var c=0u;c<4u;c++){
  m[c]=vec4f(bitcast<f32>(instances[at+12u+c*4u]),bitcast<f32>(instances[at+13u+c*4u]),bitcast<f32>(instances[at+14u+c*4u]),bitcast<f32>(instances[at+15u+c*4u]));
 }
 out.localToWorld=m;
 return out;
}`,
)

const CURVES = RENDER_CURVE_CURVES_PER_CLUSTER
const HEADER_WORDS = RENDER_CURVE_CLUSTER_HEADER_BYTES / 4

/** The header of cluster `index` and the point `pointIndex` of its curve `curveIndex`, read from the buffer `clusterData` (`clusterBuild.ts` lays it out). */
export const RENDER_CURVE_CLUSTER_WGSL = wgslBlock(
  'RENDER_CURVE_CLUSTER_WGSL',
  [RENDER_CURVE_PARAMS_WGSL],
  `struct ClusterHeader{center:vec3f,curveCount:u32,pointsPerCurve:u32,maxRadius:f32,boundCenter:vec3f,boundExtent:vec3f}
fn loadClusterHeader(index:u32)->ClusterHeader{
 let at=index*curve.clusterStrideWords;
 let counts=clusterData[at+3u];
 let radii=unpack2x16float(clusterData[at+4u]);
 let bc=unpack2x16float(clusterData[at+5u]);
 let bz=unpack2x16float(clusterData[at+6u]);
 let be=unpack2x16float(clusterData[at+7u]);
 var out:ClusterHeader;
 out.center=vec3f(bitcast<f32>(clusterData[at]),bitcast<f32>(clusterData[at+1u]),bitcast<f32>(clusterData[at+2u]));
 out.pointsPerCurve=(counts>>8u)&0xFFu;
 out.curveCount=(counts>>16u)&0xFFu;
 out.maxRadius=radii.y;
 out.boundCenter=out.center+vec3f(bc.x,bc.y,bz.x);
 out.boundExtent=vec3f(bz.y,be.x,be.y);
 return out;
}
struct CurvePoint{position:vec3f,valid:bool}
fn loadCurvePoint(header:ClusterHeader,index:u32,curveIndex:u32,pointIndex:u32)->CurvePoint{
 let at=index*curve.clusterStrideWords+${HEADER_WORDS}u+(${CURVES}u*pointIndex+curveIndex)*2u;
 let xy=unpack2x16float(clusterData[at]);
 let second=clusterData[at+1u];
 var out:CurvePoint;
 out.position=vec3f(xy,unpack2x16float(second).x)+header.center;
 out.valid=((second>>30u)&1u)!=0u;
 return out;
}`,
)

/** The scene's depth range of the visible clusters, normalised to a bin tile's segments, and the 64 bit segment: the position in the tile on 7 bits and the depth on 18 bits for each end, and the colour of the curve. */
export const RENDER_CURVE_SEGMENT_WGSL = wgslBlock(
  'RENDER_CURVE_SEGMENT_WGSL',
  [],
  `struct DepthRange{minZ:f32,range:f32,invRange:f32}
fn depthRange(a:u32,b:u32,sceneMinZ:f32)->DepthRange{
 var out:DepthRange;
 out.minZ=max(bitcast<f32>(a),sceneMinZ);
 out.range=bitcast<f32>(b)-out.minZ;
 out.invRange=1.0/max(out.range,1e-5);
 return out;
}
fn packR7(v:f32)->u32{return u32(saturate(v)*127.0)&0x7Fu;}
fn packR18(v:f32)->u32{return u32(saturate(v)*262143.0)&0x3FFFFu;}
fn packColor(c:vec3f)->u32{
 let r=((pack2x16float(vec2f(c.r,0.0))&0xFFFFu)<<15u)&0x3FF00000u;
 let g=((pack2x16float(vec2f(c.g,0.0))&0xFFFFu)<<5u)&0x000FFC00u;
 let b=((pack2x16float(vec2f(c.b,0.0))&0xFFFFu)>>5u)&0x000003FFu;
 return r|g|b;
}
fn packSegment(tile:vec2u,range:DepthRange,p0:vec3f,p1:vec3f,color:vec3f)->vec4u{
 let base=vec2f(tile*${RENDER_CURVE_BIN_TILE_SIZE}u);
 let n0=(p0.xy-base)/${RENDER_CURVE_BIN_TILE_SIZE}.0;
 let n1=(p1.xy-base)/${RENDER_CURVE_BIN_TILE_SIZE}.0;
 let z0=(p0.z-range.minZ)*range.invRange;
 let z1=(p1.z-range.minZ)*range.invRange;
 return vec4u(packR7(n0.x)|(packR7(n0.y)<<7u)|(packR18(z0)<<14u),packR7(n1.x)|(packR7(n1.y)<<7u)|(packR18(z1)<<14u),packColor(color),0u);
}
fn unpackSegmentZ(range:DepthRange,s:vec4u)->vec2f{
 return vec2f(f32((s.x>>14u)&0x3FFFFu),f32((s.y>>14u)&0x3FFFFu))/262143.0*range.range+range.minZ;
}`,
)

/** The viridis colour of `t`, the colour of a curve by its place in the scene. */
export const RENDER_CURVE_COLOR_WGSL = wgslFn(
  'curveViridis',
  [],
  `fn curveViridis(t:f32)->vec3f{
 let c0=vec3f(0.2777273272234177,0.005407344544966578,0.3340998053353061);
 let c1=vec3f(0.1050930431085774,1.404613529898575,1.384590162594685);
 let c2=vec3f(-0.3308618287255563,0.214847559468213,0.09509516302823659);
 let c3=vec3f(-4.634230498983486,-5.799100973351585,-19.33244095627987);
 let c4=vec3f(6.228269936347081,14.17993336680509,56.69055260068105);
 let c5=vec3f(4.776384997670288,-13.74514537774601,-65.35303263337234);
 let c6=vec3f(-5.435455855934631,4.645852612178535,26.3124352495832);
 let x=saturate(t);
 return c0+x*(c1+x*(c2+x*(c3+x*(c4+x*(c5+x*c6)))));
}`,
)
