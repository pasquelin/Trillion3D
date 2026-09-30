import { POINT_FACES } from '../../../../sdk-core/src/index.ts';
import { SHADOW_DEPTH_ROUNDING } from './shadowDepthRounding.ts';

/** Window origin of clipmap slot \`slot\` of record \`index\`: every reader of a sun's record. */
export const SUN_ORIGIN_WGSL = `
fn sunOrigin(index:u32,slot:i32)->vec2i{
 let pair=shadows.records[index].origins[slot/2];
 return select(pair.xy,pair.zw,(slot&1)!=0);
}`;

/**
 * Where a lit point reads a light's map — the one lookup the shading (\`shadowFactor\`) and the
 * per-pixel demand (\`../../webgpu/shadow/demandWgsl.ts\`) share: at sun \`level\` or lamp \`mip\`, the
 * point offset along its normal by \`offset\` texels of that level, its map, map texel and home
 * page. A lamp's also says whether the point lies in the face it picked, before its range.
 */
export const SHADOW_READ_AT_WGSL = `${SUN_ORIGIN_WGSL}
struct ShadowAt{map:ShadowMap,t:vec2f,home:vec2i,Q:vec3f,texel:f32,}
fn sunReadAt(index:u32,P:vec3f,N:vec3f,offset:f32,level:i32)->ShadowAt{
 let right=shadows.records[index].frame[0].xyz;let up=shadows.records[index].frame[1].xyz;
 let texel=shadowSunTexelMetres(level);
 let origin=sunOrigin(index,shadowRing(level,SUN_LEVEL_COUNT));
 let Q=P+N*(texel*offset);
 let t=vec2f(shadowSunMapTexel(dot(Q,right),origin.x,level),shadowSunMapTexel(-dot(Q,up),origin.y,level));
 let map=ShadowMap(u32(shadows.records[index].info.w)+u32(shadowSunLevelEntry(level)),1u,SUN_WINDOW_PAGES,origin.x,origin.y);
 return ShadowAt(map,t,vec2i(shadowPageOfTexel(t.x),shadowPageOfTexel(t.y)),Q,texel);
}
/** Where point \`Q\` projects on face \`face\` of lamp \`index\`, a map \`side\` texels wide: its clip
 *  and normalised position, and its map texel. The lookup's, and the soft demand's in any face. */
struct LampFacePoint{clip:vec4f,ndc:vec3f,t:vec2f,}
fn lampFacePoint(index:u32,face:u32,Q:vec3f,side:f32)->LampFacePoint{
 let clip=shadows.records[index].faces[face]*vec4f(Q,1.0);let ndc=clip.xyz/clip.w;
 return LampFacePoint(clip,ndc,vec2f(shadowLampMapTexel(ndc.x,side),shadowLampMapTexel(-ndc.y,side)));
}
struct LampAt{at:ShadowAt,clip:vec4f,ndc:vec3f,face:u32,side:f32,inside:bool,}
fn lampReadAt(index:u32,lamp:vec3f,P:vec3f,N:vec3f,offset:f32,texel0:f32,mip:u32)->LampAt{
 let info=shadows.records[index].info;
 let pages=LAMP_PAGE_COUNT>>mip;
 let side=f32(pages)*SHADOW_PAGE;
 let texel=texel0*exp2(f32(mip));
 let Q=P+N*(texel*offset);
 let isPoint=u32(info.x)==${POINT_FACES}u;
 let face=select(0u,pointFaceOf(Q-lamp),isPoint);
 let f=lampFacePoint(index,face,Q,side);let clip=f.clip;let ndc=f.ndc;let t=f.t;
 // A point's offset point lies in the face it picked: only rounding puts it past the border,
 // where the taps clamp to the face's edge. A spot's point off its face is outside its cone.
 let inside=clip.w>0.0&&!((!isPoint&&(abs(ndc.x)>1.0||abs(ndc.y)>1.0))||ndc.z<0.0||ndc.z>1.0);
 let map=ShadowMap(u32(info.w)+u32(shadowLampMapEntry(i32(face),i32(mip))),0u,i32(pages),0,0);
 let home=clamp(vec2i(shadowPageOfTexel(t.x),shadowPageOfTexel(t.y)),vec2i(0),vec2i(i32(pages)-1));
 return LampAt(ShadowAt(map,t,home,Q,texel),clip,ndc,face,side,inside);
}`;

/**
 * Which page a lit point reads, and the fraction of light that reaches it.
 *
 * **The level is chosen per pixel from its footprint** — the world distance between two
 * adjacent pixels at the depth its centre holds without the TAA jitter, `shadowFootprint`
 * (`pixelLevel`): the same every jitter phase, and the one the demand asks for (#1363). A sun
 * reads the clipmap level whose texel, `2^L` metres, is at most that footprint; a lamp reads the
 * mip whose texel at the point's distance is. A texel is thus never larger than a pixel where the
 * map can offer it, near or far, and a caster's error counted in texels is counted in pixels. The
 * GPU draws every page the frame asks for in that frame (`freshWgsl.ts`); a page not readable all
 * the same — refused at the pool's ceiling, left short by the pair list, or read by a pass that
 * asks for none — hands the point to the next coarser level, as the reference engine's virtual shadow maps fall
 * back past a page their pool could not map. The scheduler keeps the last level under
 * every page a receiver reads mapped and drawn in the frame (`admit.ts`), so the far-shadow ray
 * of a sun and the unshadowed answer of a lamp past their last level only answer before a light's
 * first request report — and, for a sun, past the scene's box, where no caster lies and the floor
 * is asked only by the report (`sunLevels.ts` floorReach).
 *
 * The receiver's plane must not shade itself over the PCF's reach: its depth's slope across the
 * map is covered, in texels of the level read, by a depth margin up to a slope of 1
 * (`shadowDepthMargin`), and past it by moving the receiver along its normal
 * (`shadowNormalTexels`). Both are bounded by the reach: a caster a few texels away always keeps
 * its shadow. The depth format's rounding is added to the reference (`SHADOW_DEPTH_ROUNDING`).
 * A point light reads the face its offset point lies in, so that point always projects inside
 * that face.
 *
 * The layout constants it reads — `SUN_WINDOW_PAGES`, the level words — are the session's: the
 * composition prints the page model for the window it was given (`shadowWgsl.ts`,
 * `pageModelWgsl.ts`), the ordinary constant by default (`referenceMode.ts`).
 */
export const SHADOW_FACTOR_WGSL = `
const SHADOW_DEPTH_ROUNDING:f32=${SHADOW_DEPTH_ROUNDING};
/** The least normal float: above the far clear, 0, and under any caster's depth. */
const SHADOW_PAST_FAR:f32=1.17549435e-38;
${SHADOW_READ_AT_WGSL}
/**
 * The reference of a receiver \`z\` along sun \`index\`, its margin taken, in a page drawn in the
 * older depth range of slot \`drawn\` (\`sunDepth.ts\`): a pair of floats of the lamp matrices,
 * eight a matrix. A receiver past that range's far side lies behind every caster drawn in it: it
 * stays above the far clear, and an empty texel lights it.
 */
fn sunRangeReference(index:u32,drawn:u32,z:f32)->f32{
 let pair=shadows.records[index].faces[drawn/8u][(drawn/2u)%4u];
 let range=select(pair.xy,pair.zw,(drawn&1u)!=0u);
 return max(1.0-(z-range.x)*(1.0/max(range.y-range.x,1e-6))+SHADOW_DEPTH_ROUNDING,SHADOW_PAST_FAR);
}
/** Offset of the neighbour page \`p\` and 1 when it is readable in the depth range of the home
 *  page (\`homeWord\`, \`sunDepth.ts\`); else the home page's and 0: one reference for every tap. */
fn shadowNeighbour(m:ShadowMap,p:vec2i,home:vec3f,homeWord:u32)->vec4f{
 let word=shadowPageWord(m,p);
 if(word==0u||((word^homeWord)>>PAGE_RANGE_SHIFT)!=0u){return vec4f(home,0.0);}
 return vec4f(shadowOffset(word,p),1.0);
}
/** The neighbours of page \`home\` a tap reads across the \`edge\` axes, toward \`step\`: along x,
 *  along y and across the corner (\`shadowNeighbour\`). Shared by \`shadowPcf\` and the PCSS filter
 *  (\`lampSoftCompare\`). */
struct ShadowNeighbours{x:vec4f,y:vec4f,d:vec4f,}
fn shadowNeighbours(m:ShadowMap,home:vec2i,step:vec2i,edge:vec2<bool>,offset:vec3f,word:u32)->ShadowNeighbours{
 var nx=vec4f(offset,0.0);var ny=nx;var nd=nx;
 if(edge.x){nx=shadowNeighbour(m,home+vec2i(step.x,0),offset,word);}
 if(edge.y){ny=shadowNeighbour(m,home+vec2i(0,step.y),offset,word);}
 if(all(edge)){nd=shadowNeighbour(m,home+step,offset,word);}
 return ShadowNeighbours(nx,ny,nd);
}
fn sunShadowFactor(index:u32,P:vec3f,N:vec3f,taps:bool)->f32{
 // Field by field: a record is six matrices wide, and the sun reads its depth ranges there alone.
 // The fourth floats of its frame: the current range, \`zNear, zFar\`, then its slot.
 let f0=shadows.records[index].frame[0];let f1=shadows.records[index].frame[1];
 let axis=shadows.records[index].frame[2].xyz;
 let zNear=f0.w;let invDepth=1.0/max(f1.w-zNear,1e-6);
 let info=shadows.records[index].info;
 let finest=i32(info.y);let last=finest+i32(info.x);
 let cosine=clamp(dot(N,-axis),1e-3,1.0);
 // An orthographic map: the receiver's depth changes by tan(incidence) per unit across it.
 let slope=sqrt(1.0-cosine*cosine)/cosine;
 let offset=shadowNormalTexels(cosine);
 for(var level=shadowSunReadLevel(shadowFootprint,finest);level<last;level++){
  let at=sunReadAt(index,P,N,offset,level);
  let word=shadowPageWord(at.map,at.home);
  if(word==0u){continue;}
  let reference=1.0-(dot(at.Q,axis)-zNear-shadowDepthMargin(at.texel,slope,1.0))*invDepth+SHADOW_DEPTH_ROUNDING;
  // A page drawn in the current range reads at \`reference\` alone, as one range always did: a
  // reference chosen per page would let the compiler round its comparisons otherwise.
  let drawn=(word>>PAGE_RANGE_SHIFT)&PAGE_RANGE_MASK;
  if(drawn==u32(shadows.records[index].frame[2].w)){return shadowPcf(at.map,at.t,reference,at.home,word,0.0,taps);}
  let past=sunRangeReference(index,drawn,dot(at.Q,axis)-shadowDepthMargin(at.texel,slope,1.0));
  return shadowPcf(at.map,at.t,past,at.home,word,0.0,taps);
 }
 return sunFarShadowFactor(P,N,-axis);
}
fn lampShadowFactor(index:u32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f,taps:bool)->f32{
 let info=shadows.records[index].info;
 let cosine=clamp(dot(N,L),1e-3,1.0);
 // The distance of the point the pixel's unjittered centre holds: its mip, the demand's (#1363).
 let radius=length(light.positionRange.xyz-(P+shadowUnjitter));
 // World texel of the finest mip at this distance, and the mip whose texel the pixel covers.
 let texel0=shadowLampFinestTexel(info.y,radius);
 let wanted=shadowLampReadMip(shadowFootprint,texel0);
 let near=info.z;
 let far=max(near*1.001,light.positionRange.w);
 // dz/dw of a perspective projection is near·far/((far−near)·w²) at axial depth w.
 let k=near*far/(far-near);
 let offset=shadowNormalTexels(cosine);
 for(var mip=u32(wanted);mip<LAMP_MIP_COUNT;mip++){
  let r=lampReadAt(index,light.positionRange.xyz,P,N,offset,texel0,mip);
  if(!r.inside){return 1.0;}
  let word=shadowPageWord(r.at.map,r.at.home);
  if(word==0u){continue;}
  // The receiver's axial depth w, clip.w, changes across the face by sin(N, axis)·cos²(ray, axis)
  // over the incidence cosine — tan(incidence) on the axis —, cos²(ray, axis) being w²/|d|². The
  // margin reaches depth by k/w²: the slope's w² cancels, and its cap of 1 becomes 1/w².
  let m=shadows.records[index].faces[r.face];let d=r.at.Q-light.positionRange.xyz;
  let facing=dot(N,vec3f(m[0].w,m[1].w,m[2].w));
  let slope=sqrt(max(1.0-facing*facing,0.0))/(dot(d,d)*cosine);
  let reference=r.ndc.z+k*shadowDepthMargin(r.at.texel,slope,1.0/(r.clip.w*r.clip.w))+SHADOW_DEPTH_ROUNDING;
  if(u32(info.x)==${POINT_FACES}u&&light.shape.x>0.0&&taps){
   let soft=pointSoftShadow(index,light,P,N,offset,texel0,mip);
   if(soft>=0.0){return soft;}
  }
  return shadowPcf(r.at.map,r.at.t,reference,r.at.home,word,r.side,taps);
 }
 return 1.0;
}
/** Fraction of light that reaches the point: 1 in full light, 0 fully in shadow — or 0 when
 *  \`taps\` is false and a page was read: the point takes no light, its pages are still asked for. */
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f,taps:bool)->f32{
 shadowTransmission=vec3f(1.0);
 if(slice<0){return 1.0;}
 let index=u32(slice);
 if(shadows.records[index].info.x<0.5){return 1.0;}
 if(isSun(light)){return sunShadowFactor(index,P,N,taps);}
 return lampShadowFactor(index,light,P,N,L,taps);
}`;
