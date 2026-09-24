import { WRAP_MAP } from '../../visibility/wrapModes.ts';
import { FEEDBACK_EVERY, FEEDBACK_STRIDE } from './feedback.ts';

const STRIDE_MASK = FEEDBACK_STRIDE - 1;

/**
 * Virtual-texture image feedback: the rank of the tile a pixel ASKS for, posted in the image's
 * feedback target and reduced to counters by a compute pass (`reduce.ts`) for one pixel in
 * sixteen. Level and address are those of the read (`slotLod`, `${k}Read`, `${k}Entry`), the
 * texture's transform included: what a pixel asks is what it reads. An anisotropic read spreads
 * its taps along the footprint, into tiles the centre does not touch: `along` (0, 1, 2) names the
 * first tap, the centre or the last, so the pixels of a footprint ask for all three; with one tap
 * all three are the centre. Requires `TILE_POOL_WGSL` and the atlas reads (`COLOR_SAMPLE_WGSL`,
 * `DATA_SAMPLE_WGSL`) before this block.
 */
const request = (
  k: string,
) => `fn ${k}RequestIndex(slot:u32,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f,next:bool,along:u32)->u32{
 let s=${k}Slot(slot);
 if(s.tail==0u){return 0u;}
 var at=uv;var lod=0.0;
 if(s.sampling==0u){lod=slotLod(s,ddx,ddy);}
 else{
  let r=${k}Read(slot,s,uv,ddx,ddy,true);
  lod=r.lod;
  at=r.uv+r.axis*(f32(i32(along)-1)*(0.5-0.5/f32(r.taps)));
 }
 let level=u32(floor(lod))+select(0u,1u,next&&lod-floor(lod)>0.0);
 if(level>=s.tail){return 0u;}
 return ${k}Entry(s,slotWrapped(s,at,wrap),level)-${k}Pages[2]+${k}Pages[0]+1u;
}`;

const m = WRAP_MAP;
/**
 * Tile rank a pixel asks for, plus one, or zero: `colorRequestIndex(slot, uv, wrap, ddx, ddy, next)`
 * and `dataRequestIndex(...)`, `next` choosing the blend's second level.
 *
 * Then the rule common to both passes that write the feedback target — opaque resolve and blend —:
 * a pixel speaks only if it is its phase (`feedbackPhase`, all of them during a convergence), and it
 * asks for ONE map, chosen by its POSITION (`requestPick`): a tile covers dozens of pixels, so each
 * map, each of the two blend levels and each end of an anisotropic footprint is named by a share
 * of them, and two complete images of the
 * same pose name the same set. The pick rank is `WRAP_MAP`'s; a missing map lets the base colour
 * speak (`mapRequest`). Hosts build their slots from the page row or the transparent item.
 */
/** Number of maps a pixel can name: the rank of `WRAP_MAP`, written once. */
const MAP_CHOICES = Object.keys(WRAP_MAP).length;
export const TILE_REQUEST_WGSL = `const MAP_CHOICES:u32=${MAP_CHOICES}u;
${request('color')}
${request('data')}
fn feedbackPhase(p:vec2f,word:u32)->bool{
 if((word&${FEEDBACK_EVERY}u)!=0u){return true;}
 return ((u32(p.x)&${STRIDE_MASK}u)|((u32(p.y)&${STRIDE_MASK}u)<<2u))==(word&${FEEDBACK_EVERY - 1}u);
}
struct RequestPick{sel:u32,next:bool,along:u32,}
fn requestPick(pos:vec2f,choices:u32)->RequestPick{
 let px=u32(pos.x)+u32(pos.y);
 return RequestPick(px%choices,((px/choices)&1u)==1u,(px/choices/2u)%3u);
}
/** \`color\`: base, emissive; \`data\`: roughness, metal, normals, occlusion. */
fn mapRequest(sel:u32,color:vec2u,data:vec4u,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f,next:bool,along:u32)->u32{
 var slot=color.x;var isColor=true;var map=${m.base}u;
 if(sel==${m.rough}u){slot=data.x;isColor=false;map=${m.rough}u;}
 else if(sel==${m.metal}u){slot=data.y;isColor=false;map=${m.metal}u;}
 else if(sel==${m.normal}u){slot=data.z;isColor=false;map=${m.normal}u;}
 else if(sel==${m.ao}u){slot=data.w;isColor=false;map=${m.ao}u;}
 else if(sel==${m.emissive}u){slot=color.y;map=${m.emissive}u;}
 if(slot==0u){slot=color.x;isColor=true;map=${m.base}u;}
 if(slot==0u){return 0u;}
 if(isColor){return colorRequestIndex(slot,uv,wrapOf(wrap,map),ddx,ddy,next,along);}
 return dataRequestIndex(slot,uv,wrapOf(wrap,map),ddx,ddy,next,along);
}`;
