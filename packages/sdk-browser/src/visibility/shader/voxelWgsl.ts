import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { byteOf } from '../../../../math/src/wgsl/integer.ts'
import { octBytesDecode } from '../../../../math/src/wgsl/octahedral.ts'
import { tangentSide } from '../../../../math/src/wgsl/basis.ts'
import { srgbToLinear, unorm8 } from '../../../../math/src/wgsl/color.ts'
import {
  VOXEL_CORNERS,
  VOXEL_PAGE_HEAD_WORDS,
  VOXEL_WORDS,
} from '../../../../sdk-core/src/page/voxelPage.ts'

/**
 * A VOXEL BRICK AS PAGE GEOMETRY (`../../../../sdk-core/src/page/voxelPage.ts`), read in place from
 * the words of its pool slot in `indices`, by the page reads every pass shares
 * (`pageGeometryWgsl.ts`): the visibility rasters, hardware and compute, the shadow pages, the
 * resolve, the temporal pass and the rays all draw a voxel the one way.
 *
 * A voxel draws as the surface of its contour (`voxel/bricks.rs`): the slab's front plane,
 * `n·(p − c) = offset + thickness/2` in voxel sides about its centre, clipped to its cube — a
 * convex polygon of three to six corners —, as a fan of four triangles; a polygon of fewer corners
 * repeats its last, and its spare triangles have no area. Corner `j` of voxel `k` is page vertex
 * `12k + j`: its depth is the plane's, and its normal the contour's, wherever the pixel lies.
 *
 * Its corners are the plane's crossings of the cube's twelve edges, a corner met twice kept once,
 * in turn about the normal (counter-clockwise seen from it): what a vertex builds alone, for its
 * own corner, in a few hundred operations, and a pass reading a whole triangle once for its three
 * (`voxelTriangle`).
 */
export const VOXEL_WGSL = wgslBlock(
  'VOXEL_WGSL',
  [byteOf, octBytesDecode, tangentSide, unorm8, srgbToLinear],
  `/** Word \`k\` of the record of voxel \`voxel\` of the brick at word \`base\`. */
fn voxelWord(base:u32,voxel:u32,k:u32)->u32{return indices[base+${VOXEL_PAGE_HEAD_WORDS}u+voxel*${VOXEL_WORDS}u+k];}
/** The contour normal of voxel \`voxel\`, object space. */
fn voxelNormal(base:u32,voxel:u32)->vec3f{return octBytesDecode(voxelWord(base,voxel,2u),2u);}
/** The front plane of a voxel's slab: its normal and its distance from the cube's centre in
 *  sides, held inside the cube so the polygon never vanishes. */
fn voxelPlane(base:u32,voxel:u32)->vec4f{
 let n=voxelNormal(base,voxel);
 let w=voxelWord(base,voxel,3u);
 let half=0.8660254;
 let offset=f32(bitcast<i32>(w<<24u)>>24u)/127.0*half;
 let thickness=f32(byteOf(w,1u))/255.0*2.0*half;
 let reach=0.5*(abs(n.x)+abs(n.y)+abs(n.z))*(1.0-1e-4);
 return vec4f(n,clamp(offset+0.5*thickness,-reach,reach));
}
/** The corners of the polygon \`plane\` cuts from the unit cube about the origin, in turn about
 *  its normal, and how many. */
struct VoxelPolygon{corners:array<vec3f,6>,count:u32,}
fn voxelPolygon(plane:vec4f)->VoxelPolygon{
 var out:VoxelPolygon;
 let n=plane.xyz;
 for(var e=0u;e<12u;e++){
  let a=e/4u;let b=(a+1u)%3u;let c=(a+2u)%3u;
  if(abs(n[a])<1e-7||out.count==6u){continue;}
  var q=vec3f(0.0);
  q[b]=select(-0.5,0.5,(e&1u)!=0u);q[c]=select(-0.5,0.5,(e&2u)!=0u);
  q[a]=(plane.w-n[b]*q[b]-n[c]*q[c])/n[a];
  if(abs(q[a])>0.5){continue;}
  var seen=false;
  for(var i=0u;i<out.count;i++){seen=seen||all(abs(out.corners[i]-q)<vec3f(1e-5));}
  if(!seen){out.corners[out.count]=q;out.count++;}
 }
 return out;
}
/** \`polygon\`'s corners in turn about \`n\`, counter-clockwise seen from it: each moved to its
 *  rank once, for every corner of the fan to read. */
fn voxelCorners(polygon:VoxelPolygon,n:vec3f)->VoxelPolygon{
 var poly=polygon;
 var centre=vec3f(0.0);
 for(var i=0u;i<poly.count;i++){centre+=poly.corners[i];}
 centre/=f32(max(poly.count,1u));
 let u=normalize(tangentSide(n));
 let v=cross(n,u);
 var angle:array<f32,6>;
 for(var i=0u;i<poly.count;i++){let d=poly.corners[i]-centre;angle[i]=atan2(dot(d,v),dot(d,u));}
 var out:VoxelPolygon;
 out.count=poly.count;
 for(var i=0u;i<poly.count;i++){
  var before=0u;
  for(var j=0u;j<poly.count;j++){before+=select(0u,1u,angle[j]<angle[i]||(angle[j]==angle[i]&&j<i));}
  out.corners[before]=poly.corners[i];
 }
 return out;
}
/** The polygon of voxel \`voxel\`'s contour, its corners in turn (\`voxelCorners\`). */
fn voxelFanCorners(base:u32,voxel:u32)->VoxelPolygon{
 let plane=voxelPlane(base,voxel);
 return voxelCorners(voxelPolygon(plane),plane.xyz);
}
/** The polygon's point corner \`j\` of its fan lies at, about the cube's centre: the origin with
 *  no polygon. */
fn voxelFanPoint(poly:ptr<function,VoxelPolygon>,j:u32)->vec3f{
 let count=(*poly).count;
 let fan=select(min(j/3u+j%3u,count-1u),0u,j%3u==0u||count==0u);
 return (*poly).corners[fan];
}
/** The object position of point \`q\` about the centre of voxel \`voxel\`'s cell. */
fn voxelObject(base:u32,voxel:u32,q:vec3f)->vec3f{
 let side=bitcast<f32>(indices[base+5u]);
 let cell=byteOf(voxelWord(base,voxel,3u),2u);
 let at=vec3f(f32(cell&3u),f32((cell>>2u)&3u),f32(cell>>4u))+0.5+q;
 return vec3f(bitcast<f32>(indices[base+2u]),bitcast<f32>(indices[base+3u]),bitcast<f32>(indices[base+4u]))+at*side;
}
/** Object position of page vertex \`vertex\` of the brick at word \`base\`: corner \`vertex % 12\`
 *  of voxel \`vertex / 12\`'s fan, on its contour. */
fn voxelPosition(base:u32,vertex:u32)->vec3f{
 let voxel=vertex/${VOXEL_CORNERS}u;
 var poly=voxelFanCorners(base,voxel);
 return voxelObject(base,voxel,voxelFanPoint(&poly,vertex%${VOXEL_CORNERS}u));
}
/** The object positions of the three page vertices \`corners\` of one voxel's triangle, as
 *  \`voxelPosition\` places each, its polygon built once. */
fn voxelTriangle(base:u32,corners:vec3u)->mat3x3f{
 let voxel=corners.x/${VOXEL_CORNERS}u;
 var poly=voxelFanCorners(base,voxel);
 let a=voxelFanPoint(&poly,corners.x%${VOXEL_CORNERS}u);
 let b=voxelFanPoint(&poly,corners.y%${VOXEL_CORNERS}u);
 let c=voxelFanPoint(&poly,corners.z%${VOXEL_CORNERS}u);
 return mat3x3f(voxelObject(base,voxel,a),voxelObject(base,voxel,b),voxelObject(base,voxel,c));
}
/** The contour normal of the voxel page vertex \`vertex\` draws. */
fn voxelVertexNormal(base:u32,vertex:u32)->vec3f{return voxelNormal(base,vertex/${VOXEL_CORNERS}u);}
/** A voxel's prefiltered surface: its base colour, linear; its occlusion, roughness and
 *  metalness; and the length of its mean normal, the spread of the normals it averages. */
struct VoxelSurface{rgb:vec3f,ao:f32,rough:f32,metal:f32,spread:f32,}
fn voxelSurface(base:u32,triangle:u32)->VoxelSurface{
 let voxel=triangle/${VOXEL_CORNERS / 3}u;
 let colour=voxelWord(base,voxel,0u);let orm=voxelWord(base,voxel,1u);
 let rgb=srgbToLinear(vec3f(unorm8(colour,0u),unorm8(colour,1u),unorm8(colour,2u)));
 return VoxelSurface(rgb,unorm8(orm,0u),unorm8(orm,1u),unorm8(orm,2u),unorm8(colour,3u));
}`,
)
