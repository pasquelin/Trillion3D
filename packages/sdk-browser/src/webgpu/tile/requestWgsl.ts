import { WRAP_MAP } from '../../visibility/wrapModes.ts'
import { FEEDBACK_EVERY, FEEDBACK_STRIDE, PICK_SHIFT } from './feedback.ts'
import { MAP_CHOICES, PICK_BLENDS, PICK_TAPS } from './pickCounts.ts'

const STRIDE_MASK = FEEDBACK_STRIDE - 1

/**
 * Virtual-texture image feedback: the rank of the tile a pixel ASKS for, posted in the image's
 * feedback target and reduced to counters by a compute pass (`reduce.ts`) for one pixel in
 * sixteen. Level and address are those of the read — the default one, or `${k}Footprint` when
 * `sampled` (`samplingWgsl.ts`) —, the texture's transform and addressing included: what a pixel
 * asks is what it reads. An anisotropic read
 * spreads its taps along the footprint, into tiles the centre does not touch: `along` (0, 1, 2)
 * names the first tap, the middle one or the last (`tapOffset`), so the pixels of a footprint ask
 * for all three. `aniso` is the read's: false for a pass that reads the isotropic level — an alpha
 * cutout (`maskAlpha`) —, which is then the level asked. `missing` names the tile only when the
 * table does not hold it at that level — the pool's own word, whose level is the finest resident
 * ancestor's —: what a convergence looks for (`everyPick`). Requires `TILE_POOL_WGSL` and the atlas
 * reads (`COLOR_SAMPLE_WGSL`, `DATA_SAMPLE_WGSL`) before this block.
 */
const tileRequestIndexWgsl = (
  k: string,
) => `fn ${k}RequestIndex(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f,next:bool,along:u32,aniso:bool,sampled:bool,missing:bool)->u32{
 let s=${k}Slot(slot);
 if(s.tail==0u){return 0u;}
 var at=uv;var lod=0.0;
 if(sampled){
  let r=${k}Footprint(slot,s,uv,ddx,ddy,aniso);
  at=r.uv+r.axis*tapOffset(along*(r.taps-1u)/2u,r.taps);lod=r.lod;
 }else{lod=slotLod(s,ddx,ddy);}
 let level=u32(floor(lod))+select(0u,1u,next&&lod-floor(lod)>0.0);
 if(level>=s.tail){return 0u;}
 let entry=${k}Entry(s,slotWrapped(s,at),level);
 let word=${k}Pages[entry];
 if(missing&&word!=0u&&((word>>24u)&0x7fu)==level){return 0u;}
 return entry-${k}Pages[2]+${k}Pages[0]+1u;
}`

/**
 * Whether a pixel speaks this image (`feedbackPhase`) and what it names: the rule every pass that
 * asks for tiles shares. An ordinary image names ONE pick (`requestPick`), its position shifted by
 * the image's pick turn. A convergence image (`feedbackEvery`) runs through all of a pixel's picks
 * (`everyPick`, `PICK_TURNS` per map) and names the first whose tile is missing: one image asks
 * every tile the pose reads, a sliver's included, so what a settled pose reads is what it asked,
 * never what the pool kept of an earlier pose.
 */
const FEEDBACK_RULE_WGSL = `const PICK_TURNS:u32=${PICK_BLENDS * PICK_TAPS}u;
fn feedbackEvery(word:u32)->bool{return (word&${FEEDBACK_EVERY}u)!=0u;}
fn feedbackPhase(p:vec2f,word:u32)->bool{
 if(feedbackEvery(word)){return true;}
 return ((u32(p.x)&${STRIDE_MASK}u)|((u32(p.y)&${STRIDE_MASK}u)<<2u))==(word&${FEEDBACK_EVERY - 1}u);
}
struct RequestPick{sel:u32,next:bool,along:u32,}
fn pickOf(px:u32,choices:u32)->RequestPick{
 return RequestPick(px%choices,((px/choices)&${PICK_BLENDS - 1}u)==1u,(px/choices/${PICK_BLENDS}u)%${PICK_TAPS}u);
}
fn requestPick(pos:vec2f,choices:u32,word:u32)->RequestPick{return pickOf(u32(pos.x)+u32(pos.y)+(word>>${PICK_SHIFT}u),choices);}
/** Pick \`turn\` of a pixel: \`choices*PICK_TURNS\` turns in a row name each of them once. */
fn everyPick(pos:vec2f,choices:u32,turn:u32)->RequestPick{return pickOf(u32(pos.x)+u32(pos.y)+turn,choices);}`

const m = WRAP_MAP
/**
 * Tile rank a pixel asks for, plus one, or zero: `colorRequestIndex(slot, uv, ddx, ddy, next,
 * along, aniso, sampled, missing)` and `dataRequestIndex(...)`, `next` choosing the blend's second level.
 *
 * Then the rule common to both passes that write the feedback target — opaque resolve and blend —:
 * a pixel speaks only if it is its phase (`feedbackPhase`, all of them during a convergence), and it
 * asks for ONE map, chosen by its POSITION (`requestPick`): a tile covers dozens of pixels, so each
 * map, each of the two blend levels and each end of an anisotropic footprint is named by a share
 * of them. The image's pick turn shifts that position (`PICK_CYCLE`), and a convergence image
 * names every pick of every pixel (`everyPick`). The camera cutout reads the
 * base map as the shading does (`maskAlphaWgsl`), so a masked base map asks one level too. The
 * pick rank is `WRAP_MAP`'s; a missing map lets the base colour speak (`mapRequest`). Hosts build their slots from the page row or the transparent item.
 */
export const TILE_REQUEST_WGSL = `const MAP_CHOICES:u32=${MAP_CHOICES}u;
${tileRequestIndexWgsl('color')}
${tileRequestIndexWgsl('data')}
${FEEDBACK_RULE_WGSL}
/** \`color\`: base, emissive; \`data\`: roughness, metal, normals, occlusion. */
fn mapRequest(p:RequestPick,missing:bool,color:vec2u,data:vec4u,uv:vec2f,ddx:vec2f,ddy:vec2f,sampled:bool)->u32{
 let sel=p.sel;
 var slot=color.x;var isColor=true;
 if(sel==${m.rough}u){slot=data.x;isColor=false;}
 else if(sel==${m.metal}u){slot=data.y;isColor=false;}
 else if(sel==${m.normal}u){slot=data.z;isColor=false;}
 else if(sel==${m.ao}u){slot=data.w;isColor=false;}
 else if(sel==${m.emissive}u){slot=color.y;}
 if(slot==0u){slot=color.x;isColor=true;}
 if(slot==0u){return 0u;}
 if(isColor){return colorRequestIndex(slot,uv,ddx,ddy,p.next,p.along,true,sampled,missing);}
 return dataRequestIndex(slot,uv,ddx,ddy,p.next,p.along,true,sampled,missing);
}`
