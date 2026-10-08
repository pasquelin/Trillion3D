import { IMPOSTOR_CARD_WGSL } from '../../visibility/shader/impostorWgsl.ts'
import { core } from '../../impostor/borrowed.ts'
import { CARD_COVERAGE_CUT } from '../../impostor/cards.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { tangentImpostor } from '../../../../math/src/wgsl/basis.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'

/** Floats of the pass's view uniform: the image's render view-projection and the camera's own, both
 *  at the eye, then the eye in two singles a component — the high words with the focal length's
 *  logarithm, the rest. */
export const CARD_VIEW_FLOATS = 40
/** The surface flag of a lit physical surface the resolve shades (`shadeWgsl.ts`). */
const LIT_SURFACE_FLAG = 2

/** The card's depth nudged toward the eye by one part in 2^20 when its surface is drawn: the
 *  visibility stage wrote the same depth, and the nudge keeps it the nearest even where two
 *  compilations of one formula round apart. Reversed Z: nearer is larger. */
const SURFACE_DEPTH_NUDGE = 1 + 2 ** -20

/**
 * THE CARD PASS: the impostor drawn as a masked surface of the one lighting model, as the
 * reference draws an impostor in its base pass. Group 0 is the image's (view and the session's card
 * records), group 1 a mesh's atlas (`feed.ts`). The records hold no view (`../../impostor/
 * cardSlots.ts`): the vertex stage takes the eye off each card's translation in double-single
 * (`cardOrigin`, the render frame's rule: the card is drawn at the eye), turns its quad to the
 * camera by the shared sprite basis (`spriteAt`, at half-extent `R`), and derives once per card what
 * every pixel of it shares: the eye in object space, the mip, the three frames, their weights and
 * capture planes, the normal matrix. A card wholly past one side of the frustum emits no triangle.
 * Two stages draw it. In the visibility raster, before the Hi-Z pyramid, `card_vis_fs` writes
 * identifier 0 — no cluster: passes rebuilding a pixel from its triangle leave it — and the depth
 * where the mesh's surface would be (the depth offset), into the depth and the pyramid's level 0,
 * so a card occludes as its mesh. After the material passes, `card_fs` writes its surface where its
 * depth is the one kept, so the lighting, the shadows and every later pass read it as they read a
 * cluster.
 */
export const cardPassWgsl = () =>
  wgslProgram(
    `
struct CardView{viewProj:mat4x4f,basis:mat4x4f,eyeHigh:vec4f,eyeLow:vec4f}
/** \`world\`: the world's linear part, its translation's high words. \`low\`: the rest of the
 *  translation. \`shape\`: object radius, frames a side, hemi (0 or 1), log2 of the texel depth at
 *  unit focal length. \`pivot\`: object-space bounding-sphere centre, then the world radius. */
struct Card{world:mat4x4f,low:vec4f,inverse:mat4x4f,shape:vec4f,pivot:vec4f}
@group(0) @binding(0) var<uniform> view:CardView;
@group(0) @binding(1) var<storage,read> cards:array<Card>;
@group(1) @binding(0) var impostorColour:texture_2d<f32>;
@group(1) @binding(1) var impostorNormalDepth:texture_2d<f32>;
@group(1) @binding(2) var impostorOrm:texture_2d<f32>;
@group(1) @binding(3) var impostorSampler:sampler;
/** The card's world translation at the eye: the high words' difference, then the low words'. */
fn cardOrigin(c:Card)->vec3f{return (c.world[3].xyz-view.eyeHigh.xyz)+(c.low.xyz-view.eyeLow.xyz);}
fn cardLinear(c:Card)->mat3x3f{return mat3x3f(c.world[0].xyz,c.world[1].xyz,c.world[2].xyz);}
/** Corner \`k\` of a card centred at \`centre\` (at the eye), counter-clockwise from the lower left:
 *  the shared sprite basis at half-extent \`radius\`, keeping its world size. */
fn cardCorner(basis:mat4x4f,centre:vec3f,radius:f32,k:u32)->vec3f{
 let side=vec2f(select(-1.0,1.0,k==1u||k==2u),select(-1.0,1.0,k>=2u));
 let place=mat4x4f(vec4f(1.0,0.0,0.0,0.0),vec4f(0.0,1.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(centre,1.0));
 return spriteAt(basis,place,side*radius,vec2f(0.0,1.0)).xyz;
}
/** Whether the four corners' clip points all lie past one side of the frustum — left, bottom,
 *  right, top, nearer than the near plane, past the far one (reversed depth). */
fn cardOutside(c0:vec4f,c1:vec4f,c2:vec4f,c3:vec4f)->bool{
 let low=max(max(c0.xyz+c0.w,c1.xyz+c1.w),max(c2.xyz+c2.w,c3.xyz+c3.w));
 let high=min(min(c0.xyz-c0.w,c1.xyz-c1.w),min(c2.xyz-c2.w,c3.xyz-c3.w));
 let far=max(max(c0.z,c1.z),max(c2.z,c3.z));
 return low.x<0.0||low.y<0.0||high.x>0.0||high.y>0.0||high.z>0.0||far<0.0;
}
/** \`point\`: the corner in object space, pivot-relative; the rest is the card's, flat. */
struct CardVary{
 @builtin(position) clip:vec4f,@location(0) point:vec3f,@location(1) @interpolate(flat) card:u32,
 @location(2) @interpolate(flat) eyeRadius:vec4f,@location(3) @interpolate(flat) weightsLod:vec4f,
 @location(4) @interpolate(flat) ab:vec4f,@location(5) @interpolate(flat) cCell:vec4f,
 @location(6) @interpolate(flat) xa:vec3f,@location(7) @interpolate(flat) xb:vec3f,@location(8) @interpolate(flat) xc:vec3f,
 @location(9) @interpolate(flat) na:vec3f,@location(10) @interpolate(flat) nb:vec3f,@location(11) @interpolate(flat) nc:vec3f,
 @location(12) @interpolate(flat) n0:vec3f,@location(13) @interpolate(flat) n1:vec3f,@location(14) @interpolate(flat) n2:vec3f,
}
@vertex fn card_vs(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->CardVary{
 var order=array<u32,6>(0u,1u,2u,0u,2u,3u);
 let c=cards[i];
 let origin=cardOrigin(c);let pivot=c.pivot.xyz;let radius=c.pivot.w;
 let centre=cardLinear(c)*pivot+origin;
 let k0=view.viewProj*vec4f(cardCorner(view.basis,centre,radius,0u),1.0);let k1=view.viewProj*vec4f(cardCorner(view.basis,centre,radius,1u),1.0);
 let k2=view.viewProj*vec4f(cardCorner(view.basis,centre,radius,2u),1.0);let k3=view.viewProj*vec4f(cardCorner(view.basis,centre,radius,3u),1.0);
 let p=cardCorner(view.basis,centre,radius,order[v]);
 let m=c.inverse;
 let back=worldMatrix3(m);
 let eye=-(back*origin)-pivot;
 let frames=c.shape.y;let hemi=c.shape.z;
 let k=impView(eye,frames,hemi);
 let na=impFrameNormal(k.a,frames,hemi);let nb=impFrameNormal(k.b,frames,hemi);let nc=impFrameNormal(k.c,frames,hemi);
 // The mip whose texel covers a pixel: the distance over the depth of one texel a pixel.
 let lod=max(0.0,log2(length(centre))-c.shape.w-view.eyeHigh.w);
 // A card wholly past one side of the frustum: one point beyond the far side for each vertex.
 let clip=select(view.viewProj*vec4f(p,1.0),vec4f(0.0,0.0,-1.0,1.0),cardOutside(k0,k1,k2,k3));
 // The normal matrix, transpose(inverse).
 let normalMatrix=transpose(back);
 return CardVary(clip,back*(p-origin)-pivot,i,vec4f(eye,c.shape.x),
  vec4f(k.w,lod),vec4f(k.a,k.b),vec4f(k.c,1.0/frames,0.0),tangentImpostor(na),tangentImpostor(nb),tangentImpostor(nc),
  na,nb,nc,normalMatrix[0],normalMatrix[1],normalMatrix[2]);
}
/** The card's surface at this pixel, and its depth: the blended surface point, at the eye,
 *  projected. A texel under the coverage cut is no surface: the pixel is discarded, in every stage
 *  alike. */
struct CardPixel{blend:ImpBlend,depth:f32}
fn cardPixel(in:CardVary)->CardPixel{
 let eye=in.eyeRadius.xyz;let radius=in.eyeRadius.w;let lod=in.weightsLod.w;let cell=in.cCell.z;
 let ray=normalize(in.point-eye);
 let b=impBlend(impTap(in.ab.xy,in.xa,in.na,eye,ray,radius,cell,lod),impTap(in.ab.zw,in.xb,in.nb,eye,ray,radius,cell,lod),
  impTap(in.cCell.xy,in.xc,in.nc,eye,ray,radius,cell,lod),in.weightsLod.xyz,lod);
 if(b.colour.a<${CARD_COVERAGE_CUT}){discard;}
 let c=cards[in.card];
 let clip=view.viewProj*vec4f(cardLinear(c)*(b.point+c.pivot.xyz)+cardOrigin(c),1.0);
 return CardPixel(b,clip.z/clip.w);
}
struct CardVis{@location(0) id:u32,@builtin(frag_depth) depth:f32}
@fragment fn card_vis_fs(in:CardVary)->CardVis{
 let px=cardPixel(in);
 return CardVis(0u,px.depth);
}
struct CardVisHiz{@location(0) id:u32,@location(1) hiz:f32,@builtin(frag_depth) depth:f32}
@fragment fn card_vis_hiz_fs(in:CardVary)->CardVisHiz{
 let px=cardPixel(in);
 return CardVisHiz(0u,px.depth,px.depth);
}
struct CardOut{@location(0) baseMetal:vec4f,@location(1) normalRough:vec4f,@location(2) emissiveAo:vec4f,@location(3) flags:u32,@builtin(frag_depth) depth:f32}
@fragment fn card_fs(in:CardVary)->CardOut{
 let px=cardPixel(in);let b=px.blend;
 let n=normalize(mat3x3f(in.n0,in.n1,in.n2)*b.normal);
 let ao=b.orm.x;
 let flag=${LIT_SURFACE_FLAG}u|select(0u,${core.EMISSIVE_AO_SURFACE_FLAG}u,ao!=1.0);
 return CardOut(vec4f(b.colour.rgb,b.orm.z),vec4f(n,b.orm.y),vec4f(0.0,0.0,0.0,ao),flag,px.depth*${SURFACE_DEPTH_NUDGE});
}`,
    [IMPOSTOR_CARD_WGSL, tangentImpostor, core.SPRITE_WGSL, worldMatrix3],
  )
