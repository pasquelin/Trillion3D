import {
  HAIR_STRANDS_CONTROL_POINT_END,
  HAIR_STRANDS_CONTROL_POINT_START,
} from '../../../sdk-core/src/contracts/hairStrandsAbi.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { HAIR_FLAG } from './materialMath.ts'

/** The words of the view block the strands' passes read (`HAIR_VIEW_WGSL`), and its bytes. */
export const HAIR_VIEW_WORDS = 44
/** The words of an instance's block (`HAIR_RIBBON_WGSL`'s `Instance`), and its bytes. */
export const HAIR_INSTANCE_WORDS = 48

/**
 * The corners of a segment's two triangles, as bits by the rank (0 to 5) of the corner among the
 * six a segment is drawn with: whether it lies at the segment's tip (the next control point), and
 * whether it lies on the strand's right. A group built for a strip of triangles (a curve given one
 * control point more at its end) cuts the ribbon along one diagonal, any other along the other.
 */
export const HAIR_RIBBON_CORNERS = {
  strip: { tips: 0b110100, rights: 0b011010 },
  list: { tips: 0b101010, rights: 0b011100 },
} as const

/** What a pass reads of the view: its view-projection (with the temporal jitter, the eye at the
 *  origin); the direction the camera faces, and in its fourth float whether the projection is
 *  orthographic; the least radius of a strand at a distance of 1 — for the pass of several samples
 *  a pixel, then for the pass of one, then the same two for a groom drawn stable —, the size in
 *  pixels, whether the samples of a pixel are sorted by depth (in the first of two words) and the
 *  inverse of the view-projection. */
export const HAIR_VIEW_WGSL = wgslBlock(
  'HAIR_VIEW_WGSL',
  [],
  `struct HairView{viewProj:mat4x4f,forward:vec4f,radii:vec4f,size:vec2f,sort:vec2f,inverseViewProj:mat4x4f}`,
)

/** The least radius of a strand at a distance of 1 the program draws with: that of the pass of
 *  several samples a pixel unless the program declares its own, the stable one for a groom drawn
 *  stable. */
const radiusAtDepth1 = wgslFn(
  'radiusAtDepth1',
  [HAIR_VIEW_WGSL],
  'fn radiusAtDepth1(stable:bool)->f32{return select(view.radii.x,view.radii.z,stable);}',
  { weak: true },
)

/**
 * THE RIBBON OF A SEGMENT. A strand is drawn as a ribbon that faces the camera: each control point
 * stands at its place in the world and moves to either side along the cross of the strand's
 * direction and the way the camera faces, by its radius, or by the least radius where that is
 * larger (a strand never thinner than the samples of a pixel can find: that radius grows with the
 * distance of the point from the camera, a perspective projection's, and is the same for an
 * orthographic one's). The segment from a control point to the next is a quad of the two points'
 * two sides, cut in two triangles. A segment is drawn unless it joins two strands: in a group built
 * for strips, unless either point ends a strand; else unless the first ends one or the second starts
 * another. The identifier of a segment is the rank of its first control point. A point whose
 * direction runs along the way the camera faces has no side, and a segment with such an end is not
 * drawn (`spineValid`).
 *
 * The program binds the group's points and tangents and the instance's block (`Instance`) in group
 * 0 and the view in group 1.
 */
export const HAIR_RIBBON_WGSL = wgslBlock(
  'HAIR_RIBBON_WGSL',
  [HAIR_VIEW_WGSL, radiusAtDepth1],
  `struct Instance{toWorld:mat4x4f,tangent0:vec4f,tangent1:vec4f,tangent2:vec4f,offsetRadius:vec4f,ids:vec4u,base:vec4f,shade:vec4f,flags:vec4u}
@group(0) @binding(0) var<storage,read> points:array<vec2u>;
@group(0) @binding(1) var<storage,read> tangents:array<u32>;
@group(0) @binding(2) var<uniform> inst:Instance;
@group(1) @binding(0) var<uniform> view:HairView;
const KIND_START=${HAIR_STRANDS_CONTROL_POINT_START}u;
const KIND_END=${HAIR_STRANDS_CONTROL_POINT_END}u;
const STRIP_TIPS=${HAIR_RIBBON_CORNERS.strip.tips}u;
const STRIP_RIGHTS=${HAIR_RIBBON_CORNERS.strip.rights}u;
const LIST_TIPS=${HAIR_RIBBON_CORNERS.list.tips}u;
const LIST_RIGHTS=${HAIR_RIBBON_CORNERS.list.rights}u;
const STABLE_RASTER=${HAIR_FLAG.stableRaster}u;
fn stableRaster()->bool{return (inst.flags.x&STABLE_RASTER)!=0u;}
// A control point placed in the world, the vector from it to its right side, and its radius.
struct Spine{position:vec3f,across:vec3f,radius:f32,ok:bool}
// The direction the strand runs through control point i, in the world.
fn tangentAt(i:u32)->vec3f{
 let d=unpack4x8snorm(tangents[i*2u+1u]).xyz;
 return inst.tangent0.xyz*d.x+inst.tangent1.xyz*d.y+inst.tangent2.xyz*d.z;
}
fn sideAt(i:u32)->vec3f{return cross(tangentAt(i),-view.forward.xyz);}
fn spineValid(i:u32)->bool{return length(sideAt(i))>0.0;}
fn spineAt(i:u32)->Spine{
 let word=points[i];
 let local=vec3f(unpack2x16float(word.x),unpack2x16float(word.y).x)+inst.offsetRadius.xyz;
 let radius=f32((word.y>>24u)&63u)/63.0*inst.offsetRadius.w;
 let position=(inst.toWorld*vec4f(local,1.0)).xyz;
 let side=sideAt(i);
 let sideLength=length(side);
 let least=select(radiusAtDepth1(stableRaster())*length(position),radiusAtDepth1(stableRaster()),view.forward.w!=0.0);
 let across=side/sideLength*max(radius,least);
 return Spine(position,across,radius,sideLength>0.0);
}
fn segmentDrawn(i:u32)->bool{
 if(i+1u>=inst.ids.y){return false;}
 let first=points[i].y>>30u;
 let second=points[i+1u].y>>30u;
 if(inst.ids.z!=0u){return first!=KIND_END&&second!=KIND_END;}
 return first!=KIND_END&&second!=KIND_START;
}
fn cornerClip(s:Spine,right:bool)->vec4f{
 return view.viewProj*vec4f(select(s.position-s.across,s.position+s.across,right),1.0);
}
fn cornerTip(k:u32)->bool{return (((select(LIST_TIPS,STRIP_TIPS,inst.ids.z!=0u))>>k)&1u)!=0u;}
fn cornerRight(k:u32)->bool{return (((select(LIST_RIGHTS,STRIP_RIGHTS,inst.ids.z!=0u))>>k)&1u)!=0u;}
`,
)

/** The least radius of a strand at a distance of 1 of one sample a pixel — the transmittance's, which
 *  draws the ribbons a sample a pixel, and the coverage's, the visibility's count not being theirs —,
 *  the stable one for a groom drawn stable: a program that lists it draws its ribbons with it. */
const oneSampleRadius = wgslFn(
  'radiusAtDepth1',
  [HAIR_VIEW_WGSL],
  'fn radiusAtDepth1(stable:bool)->f32{return select(view.radii.y,view.radii.w,stable);}',
)

/** THE COVERAGE OF A STRAND: the share of a pixel a strand of `radius` covers at the clip `w` of its
 *  point, its radius over the radius of a pixel there (the least radius of one sample a pixel, which
 *  grows with the distance under a perspective projection), at most 1. A program that lists it draws
 *  its ribbons at the width of one sample a pixel (`oneSampleRadius`). */
export const HAIR_COVERAGE_WGSL = wgslFn(
  'strandCoverage',
  [HAIR_RIBBON_WGSL, oneSampleRadius],
  `fn strandCoverage(radius:f32,w:f32)->f32{
 let least=radiusAtDepth1(stableRaster());
 let pixelRadius=select(least/w,least,view.forward.w!=0.0);
 return saturate(radius/max(radius,pixelRadius));
}`,
)
