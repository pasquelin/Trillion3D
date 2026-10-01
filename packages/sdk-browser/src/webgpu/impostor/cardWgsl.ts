import { IMPOSTOR_CARD_WGSL } from '../../visibility/shader/impostorWgsl.ts';
import { EMISSIVE_AO_SURFACE_FLAG } from '../../scene/surfaceModel.ts';

/** Floats of one card record (`Card` below): four corners, world, inverse world, shape, pivot. */
export const CARD_FLOATS = 56;
/** Floats of the pass's view uniform: the image's render view-projection and the eye. */
export const CARD_VIEW_FLOATS = 20;
/** The surface flag of a lit physical surface the resolve shades (`shadeWgsl.ts`). */
const LIT_SURFACE_FLAG = 2;
/**
 * Coverage below which a card texel is no surface: the glTF default alpha cutoff, the one a masked
 * material without its own declares. The bake stores coverage, never a cut, so the cut is the
 * runtime's; a mesh whose material declares another keeps it on its own clusters.
 */
const CARD_COVERAGE_CUT = 0.5;

/**
 * THE CARD PASS (#1335): the impostor drawn into the opaque surfaces as a masked surface of the one
 * lighting model, as the reference draws an impostor in its base pass. Group 0 is the image's
 * (view and the frame's cards), group 1 a mesh's atlas (`feed.ts`). The vertex stage reads the
 * card's four corners, which the CPU turned to the camera with the shared `spriteAt`
 * (`impostor/card.ts`); the fragment stage blends the three nearest frames, writes their surface,
 * and its depth where the mesh's surface would be (the depth offset), so the lighting, the shadows
 * and every later pass read it as they read a cluster.
 */
export const CARD_PASS_WGSL = `
struct CardView{viewProj:mat4x4f,eye:vec4f}
/** \`shape\`: object radius, frames a side, hemi (0 or 1), the mip level. \`pivot\`: object-space
 *  bounding-sphere centre. */
struct Card{corners:array<vec4f,4>,world:mat4x4f,inverse:mat4x4f,shape:vec4f,pivot:vec4f}
@group(0) @binding(0) var<uniform> view:CardView;
@group(0) @binding(1) var<storage,read> cards:array<Card>;
@group(1) @binding(0) var impostorColour:texture_2d<f32>;
@group(1) @binding(1) var impostorNormalDepth:texture_2d<f32>;
@group(1) @binding(2) var impostorOrm:texture_2d<f32>;
@group(1) @binding(3) var impostorSampler:sampler;
${IMPOSTOR_CARD_WGSL}
struct CardVary{@builtin(position) clip:vec4f,@location(0) world:vec3f,@location(1) @interpolate(flat) card:u32}
@vertex fn card_vs(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->CardVary{
 var order=array<u32,6>(0u,1u,2u,0u,2u,3u);
 let p=cards[i].corners[order[v]].xyz;
 return CardVary(view.viewProj*vec4f(p,1.0),p,i);
}
struct CardOut{@location(0) baseMetal:vec4f,@location(1) normalRough:vec4f,@location(2) emissiveAo:vec4f,@location(3) flags:u32,@builtin(frag_depth) depth:f32}
@fragment fn card_fs(in:CardVary)->CardOut{
 let c=cards[in.card];
 let eye=(c.inverse*vec4f(view.eye.xyz,1.0)).xyz-c.pivot.xyz;
 let ray=normalize((c.inverse*vec4f(in.world,1.0)).xyz-c.pivot.xyz-eye);
 let b=impBlend(eye,ray,eye,c.shape.x,c.shape.y,c.shape.z,c.shape.w);
 if(b.colour.a<${CARD_COVERAGE_CUT}){discard;}
 let n=normalize((transpose(c.inverse)*vec4f(b.normal,0.0)).xyz);
 let clip=view.viewProj*(c.world*vec4f(b.point+c.pivot.xyz,1.0));
 let ao=b.orm.x;
 let flag=${LIT_SURFACE_FLAG}u|select(0u,${EMISSIVE_AO_SURFACE_FLAG}u,ao!=1.0);
 return CardOut(vec4f(b.colour.rgb,b.orm.z),vec4f(n,b.orm.y),vec4f(0.0,0.0,0.0,ao),flag,clip.z/clip.w);
}`;
