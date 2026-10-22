import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { octBytesDecode } from '../../../../math/src/wgsl/octahedral.ts'
import { srgbToLinear, unorm8 } from '../../../../math/src/wgsl/color.ts'
import { rayBoxSpan, rayInverseDirection } from '../../../../math/src/wgsl/geometry.ts'
import { bitIsSet, highHalf, lowHalf } from '../../../../math/src/wgsl/integer.ts'
import { frameAround, intoFrame, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { rand3dPcg16, sampleSphereEven } from '../../../../math/src/wgsl/sampling.ts'
import {
  VOXEL_BRICK_CORNERS,
  VOXEL_BRICK_INDICES,
  VOXEL_BRICK_TRIANGLES,
  VOXEL_BRICK_WORDS,
  VOXEL_DDA_STEPS,
  VOXEL_PAGE_HEAD_WORDS,
  VOXEL_WORDS,
} from '../../../../sdk-core/src/page/voxelPage.ts'

/** A brick box's twelve triangles, each three of its corners — corner `c` at `x = c & 1`,
 *  `y = c >> 1 & 1`, `z = c >> 2` of the box —, counter-clockwise seen from outside. */
const BOX = [0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4]
  .concat([2, 6, 7, 2, 7, 3, 0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6])
  .join(',')

/**
 * VOXEL BRICKS AS PAGE GEOMETRY (`../../../../sdk-core/src/page/voxelPage.ts`), read in place from
 * the words of their pool slot in `indices`, by the page reads every pass shares
 * (`pageGeometryWgsl.ts`): a brick draws as its box — the box of the cells its mask holds, eight
 * corners, twelve triangles. Only these reads join the passes that draw no voxel; the trace and the
 * voxels' records are blocks of their own (`VOXEL_TRACE_WGSL`, `VOXEL_SURFACE_WGSL`), in the voxel
 * variants alone.
 */
export const VOXEL_WGSL = wgslBlock(
  'VOXEL_WGSL',
  [lowHalf, highHalf],
  `const VOXEL_BOX=array<u32,${VOXEL_BRICK_INDICES}>(${BOX});
/** The voxel count and the brick count of the page at word \`base\`. */
fn voxelCounts(base:u32)->vec2u{let w=indices[base+1u];return vec2u(lowHalf(w),highHalf(w));}
/** The page's corner, object units, and its voxels' side. */
fn voxelOrigin(base:u32)->vec3f{return vec3f(bitcast<f32>(indices[base+2u]),bitcast<f32>(indices[base+3u]),bitcast<f32>(indices[base+4u]));}
fn voxelSide(base:u32)->f32{return bitcast<f32>(indices[base+5u]);}
/** Word \`k\` of brick \`brick\`'s record: its mask (0, 1), its corner (2, 3), its joint (3) and
 *  the rank of its first voxel (4). */
fn voxelBrickWord(base:u32,brick:u32,k:u32)->u32{return indices[base+${VOXEL_PAGE_HEAD_WORDS}u+brick*${VOXEL_BRICK_WORDS}u+k];}
fn voxelBrickMask(base:u32,brick:u32)->vec2u{return vec2u(voxelBrickWord(base,brick,0u),voxelBrickWord(base,brick,1u));}
/** The joint brick \`brick\` follows, \`0xFFFF\` for none. */
fn voxelJoint(base:u32,brick:u32)->u32{return highHalf(voxelBrickWord(base,brick,3u));}
/** Brick \`brick\`'s first cell, in the page's cells. */
fn voxelBrickCell(base:u32,brick:u32)->vec3f{
 let at=voxelBrickWord(base,brick,2u);
 return vec3f(f32(lowHalf(at)),f32(highHalf(at)),f32(lowHalf(voxelBrickWord(base,brick,3u))))*4.0;
}
/** The box of the cells \`mask\` holds in its 4³ brick, in the brick's cells. */
struct VoxelBox{lo:vec3f,hi:vec3f,}
fn voxelMaskBox(mask:vec2u)->VoxelBox{
 let planes=vec4u(mask.x&0xFFFFu,mask.x>>16u,mask.y&0xFFFFu,mask.y>>16u);
 let rows=planes.x|planes.y|planes.z|planes.w;
 let xs=(rows|(rows>>4u)|(rows>>8u)|(rows>>12u))&0xFu;
 var ys=0u;var zs=0u;
 for(var k=0u;k<4u;k++){
  ys|=select(0u,1u<<k,((rows>>(4u*k))&0xFu)!=0u);
  zs|=select(0u,1u<<k,planes[k]!=0u);
 }
 let bits=vec3u(max(xs,1u),max(ys,1u),max(zs,1u));
 return VoxelBox(vec3f(firstTrailingBit(bits)),vec3f(firstLeadingBit(bits)+vec3u(1u)));
}
/** Corner \`vertex % 8\` of box \`box\`, in its brick's cells. */
fn voxelBoxPoint(box:VoxelBox,vertex:u32)->vec3f{
 let c=vertex%${VOXEL_BRICK_CORNERS}u;
 return select(box.lo,box.hi,vec3<bool>((c&1u)!=0u,(c&2u)!=0u,(c&4u)!=0u));
}
/** Page vertex \`vertex\`: corner \`vertex % 8\` of brick \`vertex / 8\`'s box, object units at rest. */
fn voxelBoxCorner(base:u32,vertex:u32)->vec3f{
 let brick=vertex/${VOXEL_BRICK_CORNERS}u;
 let cell=voxelBrickCell(base,brick)+voxelBoxPoint(voxelMaskBox(voxelBrickMask(base,brick)),vertex);
 return voxelOrigin(base)+cell*voxelSide(base);
}
/** The page vertex corner \`corner\` of the page draws, three a triangle: its brick's box corner. */
fn voxelBoxVertex(corner:u32)->u32{
 let brick=corner/${VOXEL_BRICK_INDICES}u;
 return brick*${VOXEL_BRICK_CORNERS}u+VOXEL_BOX[corner%${VOXEL_BRICK_INDICES}u];
}
/** The brick triangle \`triangle\` belongs to. */
fn voxelBrickOf(triangle:u32)->u32{return triangle/${VOXEL_BRICK_TRIANGLES}u;}
/** A box corner's normal: from the box's centre through it. */
fn voxelVertexNormal(base:u32,vertex:u32)->vec3f{
 let c=vertex%${VOXEL_BRICK_CORNERS}u;
 return normalize(vec3f(f32(c&1u),f32((c>>1u)&1u),f32(c>>2u))-vec3f(0.5));
}`,
)

/**
 * THE TRACE OF A BRICK, in its cells — its first cell at the origin, one voxel a unit —, reading no
 * buffer: what a pixel needs travels from its box's vertices (`voxelRay`, `voxelHitWgsl.ts`), so
 * the raster's fragment reads nothing but its varyings.
 *
 * A pixel of a box casts the eye's ray (`voxelCellEye`) through the brick's grid (`voxelCellTrace`):
 * it starts where the ray enters the box, steps cell to cell by the 3D DDA of Amanatides and Woo —
 * the next cell is across whichever of its three faces the ray meets first —, reads each cell's
 * bit in the brick's 64-bit mask, never a texture, and stops at the first solid cell or after
 * `VOXEL_DDA_STEPS`, the most cells a line crosses in a 4³ brick (4 + 4 + 4 − 2). A ray that
 * meets no solid cell leaves the pixel to what lies behind. The hit's depth is its cell's face the
 * ray enters by.
 *
 * The eye is the point every clip row but depth leaves at zero, from the drawing matrix itself
 * (`voxelEye`): a perspective camera's centre, an orthographic view's direction —, so one text
 * serves the camera and every light, and a deformed brick's eye is its matrix's, its joint in it.
 */
export const VOXEL_TRACE_WGSL = wgslBlock(
  'VOXEL_TRACE_WGSL',
  [VOXEL_WGSL, rayInverseDirection, rayBoxSpan, bitIsSet],
  `/** The point a drawing matrix \`m\` leaves at zero on every clip row but depth, in \`m\`'s input
 *  space: a perspective camera's centre (\`w\` not zero), an orthographic view's direction. */
fn voxelEye(m:mat4x4f)->vec4f{
 let a=vec4f(m[0].x,m[1].x,m[2].x,m[3].x);let b=vec4f(m[0].y,m[1].y,m[2].y,m[3].y);let c=vec4f(m[0].w,m[1].w,m[2].w,m[3].w);
 return vec4f(dot(a.yzw,cross(b.yzw,c.yzw)),-dot(a.xzw,cross(b.xzw,c.xzw)),dot(a.xyw,cross(b.xyw,c.xyw)),-dot(a.xyz,cross(b.xyz,c.xyz)));
}
/** The eye of \`m\` as a ray needs it: a centre (\`w\` one), or the direction of every ray (\`w\`
 *  zero), toward falling depth. */
fn voxelCellEye(m:mat4x4f)->vec4f{
 let e=voxelEye(m);
 if(abs(e.w)>1e-7*length(e.xyz)){return vec4f(e.xyz/e.w,1.0);}
 return vec4f(select(e.xyz,-e.xyz,dot(vec3f(m[0].z,m[1].z,m[2].z),e.xyz)>0.0),0.0);
}
/** The ray of eye \`eye\` (\`voxelCellEye\`) through \`o\`: away from it. */
fn voxelCellRay(eye:vec4f,o:vec3f)->vec3f{return select(eye.xyz,o-eye.xyz,eye.w!=0.0);}
/** Box \`box\` packed in one word, three bits a bound, and unpacked. */
fn voxelBoxBits(box:VoxelBox)->u32{
 let lo=vec3u(box.lo);let hi=vec3u(box.hi);
 return lo.x|(lo.y<<3u)|(lo.z<<6u)|(hi.x<<9u)|(hi.y<<12u)|(hi.z<<15u);
}
fn voxelBoxOf(bits:u32)->VoxelBox{
 let at=vec3u(0u,3u,6u);
 return VoxelBox(vec3f((vec3u(bits)>>at)&vec3u(7u)),vec3f((vec3u(bits)>>(at+vec3u(9u)))&vec3u(7u)));
}
/** Where a ray meets a brick: whether it does, its distance along the ray and the point in the
 *  brick's cells, the cell's bit in its mask, and the cells it stepped through. */
struct VoxelHit{found:bool,t:f32,point:vec3f,bit:u32,steps:u32,}
/** The ray from \`o\` along \`dir\`, both in the brick's cells, through the cells \`mask\` holds:
 *  entered at their box \`box\` — or at \`o\`, an eye inside it —, stepped cell by cell (above),
 *  stopped at the first solid one. */
fn voxelCellTrace(o:vec3f,dir:vec3f,mask:vec2u,box:VoxelBox)->VoxelHit{
 var hit:VoxelHit;
 let inv=rayInverseDirection(dir);
 let span=rayBoxSpan(box.lo,box.hi,o,inv);
 if(span.x>=span.y){return hit;}
 var t=span.x;
 var cell=clamp(vec3i(floor(o+dir*(span.x+1e-4*(span.y-span.x)))),vec3i(box.lo),vec3i(box.hi)-vec3i(1));
 let step=vec3i(sign(dir));
 let delta=abs(inv);
 var next=(vec3f(cell)+select(vec3f(0.0),vec3f(1.0),dir>vec3f(0.0))-o)*inv;
 for(var s=0u;s<${VOXEL_DDA_STEPS}u;s++){
  let bit=u32(cell.x+4*cell.y+16*cell.z);
  hit.steps=s+1u;
  if(bitIsSet(select(mask.x,mask.y,bit>=32u),bit)){
   hit.found=true;hit.t=t;hit.point=o+dir*t;hit.bit=bit;
   return hit;
  }
  var axis=2u;
  if(next.x<next.y&&next.x<next.z){axis=0u;}else if(next.y<next.z){axis=1u;}
  t=next[axis];cell[axis]+=step[axis];next[axis]+=delta[axis];
  if(t>=span.y||any(cell<vec3i(box.lo))||any(cell>=vec3i(box.hi))){break;}
 }
 return hit;
}`,
)

/**
 * A VOXEL'S RECORD, past its page's bricks: what the resolve reads of the voxel a pixel shows — its
 * rank among the page's voxels, its normal, its prefiltered surface and the shading normal its
 * fitted distribution of normals gives the pixel.
 */
export const VOXEL_SURFACE_WGSL = wgslBlock(
  'VOXEL_SURFACE_WGSL',
  [
    VOXEL_WGSL,
    octBytesDecode,
    unorm8,
    srgbToLinear,
    frameAround,
    intoFrame,
    outOfFrame,
    rand3dPcg16,
    sampleSphereEven,
  ],
  `/** The rank in the page of brick \`brick\`'s voxel at bit \`bit\`: its brick's first voxel's, which
 *  the record holds, and the mask's bits below its own. */
fn voxelRank(base:u32,brick:u32,bit:u32)->u32{
 let rank=voxelBrickWord(base,brick,4u);
 let m=voxelBrickMask(base,brick);
 if(bit<32u){return rank+countOneBits(m.x&((1u<<bit)-1u));}
 return rank+countOneBits(m.x)+countOneBits(m.y&((1u<<(bit-32u))-1u));
}
/** Word \`k\` of the record of voxel \`voxel\` of the page, past its bricks'. */
fn voxelWord(base:u32,voxel:u32,k:u32)->u32{
 return indices[base+${VOXEL_PAGE_HEAD_WORDS}u+voxelCounts(base).y*${VOXEL_BRICK_WORDS}u+voxel*${VOXEL_WORDS}u+k];
}
/** The normal of voxel \`voxel\`, object space: the axis of its fitted distribution of normals, else
 *  the direction of their mean. */
fn voxelNormal(base:u32,voxel:u32)->vec3f{return octBytesDecode(voxelWord(base,voxel,2u),0u);}
/** The ratio of the two widths of voxel \`voxel\`'s fitted distribution of normals (its record's byte
 *  10): 0 a mirror about its axis, one half a sphere of normals; 0 where the build fits none. */
fn voxelRatio(base:u32,voxel:u32)->f32{return unorm8(voxelWord(base,voxel,2u),2u);}
/** A voxel pixel's shading normal: a normal of the voxel's fitted distribution about the unit
 *  \`axis\` that the eye, along the unit \`V\`, sees, drawn with the noise of pixel \`pixel\` and image
 *  \`frame\`. The ratio sets the widths: over one half the lobe narrows along the axis, under it
 *  across; at 0 it is the axis itself. The view is stretched by the widths to the sphere's, a
 *  direction taken about it by the cosine, then stretched back. */
fn voxelSampledNormal(axis:vec3f,ratio:f32,V:vec3f,pixel:vec2i,frame:u32)->vec3f{
 if(ratio<=0.0){return axis;}
 var a=vec3f(1.0);
 if(ratio>0.5){a.z=2.0-2.0*ratio;}else{a.x=2.0*ratio;a.y=a.x;}
 let e=vec2f(rand3dPcg16(vec3i(pixel,i32(frame))).xy)/65535.0;
 let f=frameAround(axis);
 let sv=normalize(intoFrame(f,V)*a);
 let sm=normalize(sv+sampleSphereEven(e));
 return outOfFrame(normalize(sm*a),f);
}
/** A voxel's prefiltered surface: its base colour, linear; its occlusion, roughness and
 *  metalness. */
struct VoxelSurface{rgb:vec3f,ao:f32,rough:f32,metal:f32,}
fn voxelSurface(base:u32,voxel:u32)->VoxelSurface{
 let colour=voxelWord(base,voxel,0u);let orm=voxelWord(base,voxel,1u);
 let rgb=srgbToLinear(vec3f(unorm8(colour,0u),unorm8(colour,1u),unorm8(colour,2u)));
 return VoxelSurface(rgb,unorm8(orm,0u),unorm8(orm,1u),unorm8(orm,2u));
}`,
)
