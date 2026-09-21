import { LIGHT_SETTINGS, POINT_FACES, SHADOW_PAGE } from '../sdk-core/index.ts';

const POISSON_16 = [
  [-0.94201624, -0.39906216],
  [0.94558609, -0.76890725],
  [-0.094184101, -0.9293887],
  [0.34495938, 0.2938776],
  [-0.91588581, 0.45771432],
  [-0.81544232, -0.87912464],
  [-0.38277543, 0.27676845],
  [0.97484398, 0.75648379],
  [0.44323325, -0.97511554],
  [0.53742981, -0.4737342],
  [-0.26496911, -0.41893023],
  [0.79197514, 0.19090188],
  [-0.2418884, 0.99706507],
  [-0.81409955, 0.9143759],
  [0.19984126, 0.78641367],
  [0.14383161, -0.1410079],
];

/**
 * Shadow-atlas read: one slice per light, six faces for a point light, one for a spotlight,
 * the cascades for a directional light. Depth compare with constant bias and slope bias,
 * then average of sixteen taps. Bounds come from the published settings — neither the slice
 * nor the kernel can overflow the face rectangle.
 */
/** A shadow slice as the GPU reads it: the matrix and atlas rectangle of each face, then
 *  the header (faces, aperture, side, near plane). Shared by every shader that reads a
 *  slice, in the buffer or copied into a uniform. */
export const SHADOW_SLICE_WGSL = `struct ShadowFace{viewProjection:mat4x4f,rect:vec4f,drawn:vec4u,}
struct ShadowSlice{faces:array<ShadowFace,${POINT_FACES}>,info:vec4f,}`;

export const DIRECT_SHADOW_WGSL = `
${SHADOW_SLICE_WGSL}
struct ShadowSlices{items:array<ShadowSlice>,}
const PCF_TAPS:u32=${LIGHT_SETTINGS.pcfTaps}u;
const SHADOW_BIAS:f32=${LIGHT_SETTINGS.shadowDepthBias};
const SHADOW_SLOPE:f32=${LIGHT_SETTINGS.shadowSlopeBias};
const SHADOW_SLOPE_MAX:f32=${LIGHT_SETTINGS.shadowSlopeBiasMax};
const SHADOW_NORMAL_TEXELS:f32=${LIGHT_SETTINGS.shadowNormalOffsetTexels};
const SHADOW_PAGE:f32=${SHADOW_PAGE}.0;
const POISSON:array<vec2f,${LIGHT_SETTINGS.pcfTaps}>=array<vec2f,${LIGHT_SETTINGS.pcfTaps}>(${POISSON_16.map(
  ([x, y]) => `vec2f(${x},${y})`,
).join(',')});
/** Bias in metres at the considered point: a grazing surface needs more margin than a facing
 *  one. The margin is ADDED to the reference, shadow depth being reversed like the camera's:
 *  bringing the reference closer to the light means increasing it. */
fn shadowBiasMetres(cosine:f32)->f32{
 return SHADOW_BIAS+min(SHADOW_SLOPE*sqrt(1.0-cosine*cosine)/cosine,SHADOW_SLOPE_MAX);
}
/** Pages per side of a face. */
fn faceRows(side:f32)->f32{return max(round(side/SHADOW_PAGE),1.0);}
/** Physical page of the extent origin, as a fraction of the face: the two spare words of the
 *  held mask. A cascade map is addressed by absolute page modulo the face; a point or spot
 *  face, whose extent never slides, wraps by zero. */
fn faceWrap(entry:ShadowFace,rows:f32)->vec2f{return vec2f(entry.drawn.zw)/rows;}
/** Does the page under this extent coordinate hold a depth of the extent? A page that entered
 *  a slid extent but is not drawn yet holds what the far side left there: it is read by no one.
 *  A page merely awaiting a redraw still holds one, and is read until its redraw lands. */
fn pageDrawn(entry:ShadowFace,local:vec2f,rows:f32,wrap:vec2f)->bool{
 let page=vec2u(clamp(fract(local+wrap)*rows,vec2f(0.0),vec2f(rows-1.0)));
 // Rows of eight bits, whatever the face's own row count: the host packs the mask that way.
 let bit=page.y*8u+page.x;
 let word=select(entry.drawn.x,entry.drawn.y,bit>=32u);
 return ((word>>(bit&31u))&1u)!=0u;
}
/**
 * Sixteen taps in the face rectangle, offset by a slice texel, never by an atlas texel. The
 * extent coordinate is wrapped onto the face by \`wrap\`, zero for a face that never slides. A
 * tap is held at the last
 * texel centre of the extent, so an extent edge never wraps to the far side; and at the last
 * texel centre of the face, so the seam of a slid extent never blends with the neighbouring
 * face — the tap that would straddle the seam reads the edge texel instead, a named
 * approximation one texel wide along that seam.
 */
fn shadowPcf(entry:ShadowFace,local:vec2f,reference:f32,side:f32,wrap:vec2f)->f32{
 let step=1.0/max(side,1.0);
 let edge=vec2f(0.5*step);
 var lit=0.0;
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let offset=POISSON[tap]*step;
  let inside=clamp(local+offset,edge,vec2f(1.0)-edge);
  let uv=entry.rect.xy+clamp(fract(inside+wrap),edge,vec2f(1.0)-edge)*entry.rect.z;
  lit+=textureSampleCompareLevel(shadowAtlas,shadowSampler,uv,reference);
 }
 return lit/f32(PCF_TAPS);
}
/**
 * Sun cascades: the first whose point falls in the unit cube, on a drawn page, wins, and the
 * loop is bounded by the published cascade count (X2). A page not drawn yet hands the point
 * to the next cascade, as an unmapped page of a virtual shadow map falls back to a coarser
 * level. The cascade scale is read from its own matrix — orthographic, so the world texel is
 * 2/(scale in x · side) and a metre of depth is the scale in z. No double data, so nothing
 * that can diverge.
 */
fn sunShadowFactor(slice:u32,cascades:u32,P:vec3f,N:vec3f,L:vec3f)->f32{
 let cosine=clamp(dot(N,L),1e-3,1.0);
 let side=max(shadows.items[slice].info.z,1.0);
 let rows=faceRows(side);
 for(var c=0u;c<min(SUN_CASCADES,cascades);c++){
  // One face read per cascade tried, never the whole slice: the record is six faces wide.
  let entry=shadows.items[slice].faces[c];
  if(entry.rect.w<0.5){continue;}
  let m=entry.viewProjection;
  let scaleX=max(length(vec3f(m[0][0],m[1][0],m[2][0])),1e-9);
  let scaleZ=length(vec3f(m[0][2],m[1][2],m[2][2]));
  let texel=2.0/(scaleX*side);
  let clip=m*vec4f(P+N*texel*SHADOW_NORMAL_TEXELS/max(cosine,0.2),1.0);
  let ndc=clip.xyz/clip.w;
  if(abs(ndc.x)>1.0||abs(ndc.y)>1.0||ndc.z<0.0||ndc.z>1.0){continue;}
  let local=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5);
  let wrap=faceWrap(entry,rows);
  if(!pageDrawn(entry,local,rows,wrap)){continue;}
  return shadowPcf(entry,local,ndc.z+shadowBiasMetres(cosine)*scaleZ,side,wrap);
 }
 // Beyond the last cascade, the shadow is tested by a ray against the resident proxy. With
 // no proxy in the cache, that ray returns one, the distant surface stays lit with no cast
 // shadow, and the diagnostic says "distant shadow unavailable": never an invented shadow.
 return sunFarShadowFactor(P,N,L);
}
/** Fraction of light that reaches the point: 1 in full light, 0 fully in shadow. */
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f)->f32{
 if(slice<0){return 1.0;}
 let index=u32(slice);
 let info=shadows.items[index].info;
 let faces=u32(info.x);
 if(faces==0u){return 1.0;}
 if(isSun(light)){return sunShadowFactor(index,faces,P,N,L);}
 let face=select(0u,pointFaceOf(P-light.positionRange.xyz),faces==POINT_FACES);
 let entry=shadows.items[index].faces[face];
 if(entry.rect.w<0.5){return 1.0;}
 // The read point is offset along the normal by a slice texel, divided by the incidence
 // cosine: a texel covers more depth the more grazing the surface. That is the offset that
 // closes the seam between two faces of a point light and removes grazing acne.
 let cosine=clamp(dot(N,L),1e-3,1.0);
 let radius=length(light.positionRange.xyz-P);
 let side=max(info.z,1.0);
 let texel=2.0*info.y*radius/side;
 let clip=entry.viewProjection*vec4f(P+N*texel*SHADOW_NORMAL_TEXELS/max(cosine,0.2),1.0);
 if(clip.w<=0.0){return 1.0;}
 let ndc=clip.xyz/clip.w;
 if(abs(ndc.x)>1.0||abs(ndc.y)>1.0||ndc.z<0.0||ndc.z>1.0){return 1.0;}
 let local=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5);
 // These metres become a depth margin at the considered point: dz/dd of a perspective
 // projection is near·far/((far−near)·d²), so the margin follows the distance to the light.
 let near=info.w;
 let far=max(near*1.001,light.positionRange.w);
 let scale=near*far/((far-near)*max(clip.w*clip.w,1e-4));
 return shadowPcf(entry,local,ndc.z+shadowBiasMetres(cosine)*scale,side,vec2f(0.0));
}`;
