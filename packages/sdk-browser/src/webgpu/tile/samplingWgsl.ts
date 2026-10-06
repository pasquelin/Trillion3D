import { SAMPLING_FOOTPRINT_WGSL } from '../../texture/samplingFootprint.ts'
import {
  WRAP_S_MIRROR,
  WRAP_S_REPEAT,
  WRAP_T_MIRROR,
  WRAP_T_REPEAT,
} from '../../visibility/wrapModes.ts'
import { SAMPLE_TRANSFORMED } from '../../texture/sampling.ts'

/**
 * The shader side of a texture's sampling words (`sampling.ts`), inside `TILE_POOL_WGSL`
 * (`wgsl.ts`). A page none of whose maps has a filter word never runs it: its reads are the
 * default one (`slotLod`, `atlasReadWgsl`). Otherwise the UV transform maps the
 * coordinate and its derivatives first, so level, seam and tile are those of the transformed
 * coordinate; the filter word then picks the level and whether a level is read at the centre of
 * its texel or mixed by the sampler. Anisotropy averages `taps` reads along the longer axis of
 * the footprint, each over its share of it — once when it is hardly elongated
 * (`ANISOTROPY_SLACK`), otherwise as many as the ratio, which the grant — 16 at most, the 4-bit
 * field of the sampling word (`MAX_ANISOTROPY`) — bounds: no footprint within the grant is read
 * with fewer taps than it is stretched. `tapOffset` places tap `i` of `n` on that line, for
 * the read and for the request alike.
 */
export const SAMPLING_WGSL = `/** How one sample reads: the coordinate after the texture's transform, the line anisotropy spreads
 *  its \`taps\` over, the level, and whether texels are picked rather than mixed. */
${SAMPLING_FOOTPRINT_WGSL}
/** The centre of the texel a coordinate falls in, for a nearest read; the coordinate otherwise. */
fn pickTexel(texel:vec2f,nearest:bool)->vec2f{return select(texel,floor(texel)+0.5,nearest);}
/** One axis of a tap line folded once (\`foldLine\`): the folded centre, the direction the taps run
 *  in the folded period, and 1 when the whole line, \`reach\` around its centre, stays in one period. */
fn foldAxis(t:f32,reach:f32,repeat:bool,mirror:bool)->vec3f{
 if(!repeat&&!mirror){return vec3f(t,1.0,select(0.0,1.0,t-reach>=0.0&&t+reach<=1.0));}
 let k=floor(t);
 let odd=mirror&&k-2.0*floor(k*0.5)>0.5;
 let inside=floor(t-reach)==k&&floor(t+reach)==k;
 return vec3f(select(t-k,1.0-(t-k),odd),select(1.0,-1.0,odd),select(0.0,1.0,inside));
}
/** A tap line folded once by its addressing: \`dir.x\` zero when it leaves its period or meets a
 *  seam, where each tap folds itself. The line reaches half a texel past its ends; on a repeating
 *  axis, half a texel of \`seam\`, the coarsest level the read mixes, whose seam is the widest. */
struct FoldedLine{uv:vec2f,dir:vec2f,}
fn foldLine(r:TileRead,wrap:u32,size:vec2f,seam:vec2f)->FoldedLine{
 let half=abs(r.axis)*0.5;
 let reach=select(half+0.5/size,half+0.5/seam,vec2<bool>((wrap&${WRAP_S_REPEAT}u)!=0u,(wrap&${WRAP_T_REPEAT}u)!=0u));
 let x=foldAxis(r.uv.x,reach.x,(wrap&${WRAP_S_REPEAT}u)!=0u,(wrap&${WRAP_S_MIRROR}u)!=0u);
 let y=foldAxis(r.uv.y,reach.y,(wrap&${WRAP_T_REPEAT}u)!=0u,(wrap&${WRAP_T_MIRROR}u)!=0u);
 return FoldedLine(vec2f(x.x,y.x),vec2f(x.y,y.y)*x.z*y.z);
}`

/** The footprint read of atlas `k` through the texture's filter rule, and through its UV
 *  transform when it has one, whose words the transform flag alone fetches. */
export const samplingReadWgsl = (
  k: string,
) => `/** How a footprint reads: the texture's filter rule through its UV transform — the affine
 *  2 × 3 matrix the WebGL2 path applies, on the coordinate and on its derivatives. A zero filter
 *  word reads as the default read does. */
fn ${k}Footprint(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,aniso:bool)->TileRead{
 if((s.sampling&${SAMPLE_TRANSFORMED}u)==0u){return tileRead(s,uv,ddx,ddy,aniso);}
 let h=PAGE_HEADER+slot*PAGE_SLOT+PAGE_TRANSFORM;
 let m=mat2x2f(bitcast<f32>(${k}Pages[h]),bitcast<f32>(${k}Pages[h+1u]),bitcast<f32>(${k}Pages[h+2u]),bitcast<f32>(${k}Pages[h+3u]));
 let t=vec2f(bitcast<f32>(${k}Pages[h+4u]),bitcast<f32>(${k}Pages[h+5u]));
 return tileRead(s,m*uv+t,m*ddx,m*ddy,aniso);
}
/** The taps of one level along a line already folded, the table entry read once when the line
 *  stays in one tile of that level — a segment whose ends share a tile lies in it. */
fn ${k}Line(s:TileSlot,c:vec2f,step:vec2f,n:u32,level:u32,nearest:bool)->vec4f{
 var word=0u;var oneTile=level>=s.tail;
 if(!oneTile){
  let first=${k}Entry(s,c+step*tapOffset(0u,n),level);
  oneTile=first==${k}Entry(s,c+step*tapOffset(n-1u,n),level);
  if(oneTile){word=${k}Pages[first];}
 }
 var sum=vec4f(0.0);
 for(var i=0u;i<n;i++){
  let uv=c+step*tapOffset(i,n);
  var w=word;
  if(!oneTile){w=${k}Pages[${k}Entry(s,uv,level)];}
  sum+=${k}Tap(s.tap,${k}Place(s,uv,level,w,nearest));
 }
 return sum/f32(n);
}`

/**
 * Public atlas read, `name(slot, uv, ddx, ddy, sampled)`: the header is read once, then each level
 * read wraps by the addressing nibble of the texture's header (`${k}Level`, `wgsl.ts`) — a single
 * fetch off a seam, four mixed on the seam of a repeating period at that level's size, where the
 * sampler's rule would mix the last texel and the first: it is the read that wraps, not the
 * coordinate. `name + 'At'` is one read at a level of detail, which `name` dispatches.
 *
 * `sampled` is the page's or the item's, never the texture's: a class override in the resolve
 * (`HAS_SAMPLING`), which the compiler folds, a flag of the draw elsewhere (`FLAG_SAMPLED`). False,
 * the read is the default one and nothing more: the level of the footprint, texels mixed. True,
 * every map of the material goes through its transform and filter rule (`${k}Footprint`): a
 * nearest read takes the texel the fold named, seam or not, and anisotropy, when `anisotropic`,
 * averages its taps: the line folded once when it stays in one period off its seams — then each
 * level's taps are summed with one table read per tile and mixed across the two levels once —,
 * each tap folded alone otherwise. A read that is not — the alpha cutout of the visibility and
 * shadow passes, which only compares a threshold — takes one tap at the isotropic level.
 */
export const atlasReadWgsl = (name: string, k: string, out: string, anisotropic: boolean) => {
  const at = `${name}At`
  const taps = anisotropic
    ? `fn ${name}Taps(s:TileSlot,r:TileRead)->${out}{
 let n=r.taps;
 let line=foldLine(r,s.wrap,s.size,levelSize(s.size,u32(ceil(r.lod))));
 if(line.dir.x==0.0){
  var sum=${out}();
  for(var i=0u;i<n;i++){sum+=${at}(s,r.uv+r.axis*tapOffset(i,n),r.lod,r.nearest);}
  return sum/f32(n);
 }
 let step=r.axis*line.dir;
 let l0=floor(r.lod);let t=r.lod-l0;
 let a=${k}Line(s,line.uv,step,n,u32(l0),r.nearest);
 if(t<=0.0||l0>=f32(s.last)){return a;}
 return mix(a,${k}Line(s,line.uv,step,n,u32(l0)+1u,r.nearest),t);
}
`
    : ''
  return `${taps}fn ${name}Sampled(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f)->${out}{
 let r=${k}Footprint(slot,s,uv,ddx,ddy,${anisotropic});
${
  anisotropic
    ? ` if(r.taps>1u){return ${name}Taps(s,r);}
`
    : ''
} return ${at}(s,r.uv,r.lod,r.nearest);
}
fn ${name}(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f,sampled:bool)->${out}{
 let s=${k}Slot(slot);
 if(sampled){return ${name}Sampled(slot,s,uv,ddx,ddy);}
 return ${at}(s,uv,slotLod(s,ddx,ddy),false);
}`
}
