import * as layer from './layers.ts';
import { FLAG_DYNAMIC } from '../visibility/types.ts';

/** `text` in a resolve that carries the as-is share, `none` in the flagless one. */
export const shareText =
  (asIs: boolean) =>
  (text: string, none = '') =>
    asIs ? text : none;

/** The most a reactive value lets the current image take: FSR 2 holds it below 1, so a
 *  transparent never drops its history whole and still averages its jitter. */
export const REACTIVE_MAX = 0.9;

/**
 * History read while the image moves: Catmull-Rom on the 4×4 texels around the point, in five
 * bilinear taps — the four corners, which weigh least, dropped and the rest renormalised (Karis,
 * SIGGRAPH 2014). Bilinear softens the history a little every image the pixel moves by a fraction;
 * Catmull-Rom keeps its sharpness. Its negative lobes may overshoot: the neighbour box clamps them.
 */
export const CATMULL_ROM_WGSL = `
fn historyCatmullRom(uv:vec2f)->vec4f{
 let p=uv*view.viewport.xy;
 let c=floor(p-0.5)+0.5;
 let f=p-c;
 let w0=f*(-0.5+f*(1.0-0.5*f));
 let w1=1.0+f*f*(-2.5+1.5*f);
 let w2=f*(0.5+f*(2.0-1.5*f));
 let w3=f*f*(-0.5+0.5*f);
 let w12=w1+w2;
 let t0=(c-1.0)*view.viewport.zw;
 let t3=(c+2.0)*view.viewport.zw;
 let t12=(c+w2/w12)*view.viewport.zw;
 var sum=textureSampleLevel(history,historySampler,vec2f(t12.x,t0.y),0.0)*(w12.x*w0.y);
 sum+=textureSampleLevel(history,historySampler,vec2f(t0.x,t12.y),0.0)*(w0.x*w12.y);
 sum+=textureSampleLevel(history,historySampler,t12,0.0)*(w12.x*w12.y);
 sum+=textureSampleLevel(history,historySampler,vec2f(t3.x,t12.y),0.0)*(w3.x*w12.y);
 sum+=textureSampleLevel(history,historySampler,vec2f(t12.x,t3.y),0.0)*(w12.x*w3.y);
 let total=w12.x*w0.y+w0.x*w12.y+w12.x*w12.y+w3.x*w12.y+w12.x*w3.y;
 return max(sum/total,vec4f(0.0));
}`;

/**
 * Uncovered pixels, told by the visibility identifiers (#833). Each history pixel keeps, beside its
 * as-is share, the tag of the placement its identifier belonged to — folded to 1‥255 for 8 bits, 0
 * the background. A pixel is uncovered when none of the four history texels its point reads holds
 * the tag of any render texel of its 3×3: what it showed is no longer around it (a ball gone from
 * the ground it hid). The pixel's `own` tag, the one it writes, is tried first: a pixel
 * that still shows what it showed reads no identifier more. An edge, whose 3×3 holds both sides, is never uncovered; two placements
 * that share a tag only keep today's clamp.
 */
export const PLACEMENT_TAG_WGSL = `
fn placementTag(at:vec2i)->u32{
 let id=textureLoad(ids,at,0).r;
 if(id==0u){return 0u;}
 return placementOf(id)%255u+1u;
}
fn dynamicPixel(at:vec2i)->f32{
 let id=textureLoad(ids,at,0).r;
 if(id==0u){return 0.0;}
 return select(0.0,1.0,(pages[(id>>8u)-1u].flags&${FLAG_DYNAMIC}u)!=0u&&pages[(id>>8u)-1u].deformOutput==0u);
}
fn uncovered(uv:vec2f,centre:vec2i,last:vec2i,own:f32)->bool{
 let kept=textureGather(1,tagHistory,historySampler,uv)*255.0;
 if(any(abs(kept-own*255.0)<vec4f(0.5))){return false;}
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let tag=f32(placementTag(clamp(centre+vec2i(dx,dy),vec2i(0),last)));
  if(any(abs(kept-tag)<vec4f(0.5))){return false;}
 }}
 return true;
}`;

/**
 * The current image's share of a moving pixel (#816's blend, point 6): today's `alpha` times
 * `reach`, the weight of the sample nearest the display pixel — one that fell far from it does not
 * overwrite its history —, raised to the pixel's reactive value, never above `REACTIVE_MAX`; a pixel
 * with no history (`fresh`) takes the current sample whole.
 */
export const CURRENT_SHARE_WGSL = `
fn currentShare(alpha:f32,reach:f32,rho:f32,fresh:bool)->f32{
 if(fresh){return 1.0;}
 return max(alpha*reach,min(rho,${REACTIVE_MAX}));
}`;

/**
 * What both resolves close with, once `previous`, `filtered`, the YCoCg box `lo`–`hi`, `centre`
 * (the render texel of the display pixel, `last` the grid's last), `reach` and, with `asIs`,
 * `share` and its box are known: history read at the reprojected point, clamped to the box, mixed
 * with the current image by the inverse of each one's luminance. At rest (`view.jitter.z` 0) that
 * is today's resolve, to the bit. While moving the history is read with Catmull-Rom, and the
 * current share is `currentShare`'s, from the reactive value the blends and particles wrote — whole
 * on a dynamic geometry's pixel (`dynamicPixel`, #573), whose vertices moved within their placement,
 * which no motion matrix follows: its history is another shape, dropped rather than smeared.
 */
export const taaHistoryBlend = (asIs: boolean, filtered = false) => {
  const share = shareText(asIs);
  return ` if(previous.z==0.0){return ${layer.taaOut(asIs, filtered)};}
 var alpha=view.params.x;
 var read=vec4f(0.0);
 if(view.jitter.z!=0.0){
  read=historyCatmullRom(previous.xy);
  let rho=max(textureLoad(reactive,min(centre,vec2i(textureDimensions(reactive))-vec2i(1)),0).g,dynamicPixel(centre));
  alpha=currentShare(alpha,reach,rho,uncovered(previous.xy,centre,last,tag));
 }else{read=textureSampleLevel(history,historySampler,previous.xy,0.0);}
 let clamped=clamp(vec4f(toYcocg(read.rgb),read.a),lo,hi);
 let kept=vec4f(fromYcocg(clamped.xyz),clamped.w);
${share(' let keptShare=clamp(textureSampleLevel(shareHistory,historySampler,previous.xy,0.0).r,shareLo,shareHi);\n')} let wc=alpha/(1.0+toYcocg(filtered.rgb).x);
 let wh=(1.0-alpha)/(1.0+clamped.x);
${layer.layerWgsl(filtered, 'kept')} return ${layer.taaOut(asIs, filtered, true)};`;
};
