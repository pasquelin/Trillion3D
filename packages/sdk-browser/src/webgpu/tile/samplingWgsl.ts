import {
  WRAP_S_MIRROR,
  WRAP_S_REPEAT,
  WRAP_T_MIRROR,
  WRAP_T_REPEAT,
} from '../../visibility/wrapModes.ts';
import {
  SAMPLE_ANISOTROPY_SHIFT,
  SAMPLE_MAG_HALF,
  SAMPLE_MAG_NEAREST,
  SAMPLE_MIN_NEAREST,
  SAMPLE_MIP_NEAREST,
  SAMPLE_MIP_NONE,
  SAMPLE_TRANSFORMED,
} from './sampling.ts';

/** The most taps an anisotropic read takes, as current hardware does. */
const MAX_TAPS = 8;
/** Elongation a footprint may have and still be read once, at the isotropic level, like a
 *  texture granted no anisotropy: a surface seen face-on, up to rounding. */
const ANISOTROPY_SLACK = 0.01;

/**
 * The shader side of a texture's sampling words (`sampling.ts`), inside `TILE_POOL_WGSL`
 * (`wgsl.ts`). A page none of whose maps has a filter word never runs it: its reads are the
 * default one (`slotLod`, `atlasReadWgsl`). Otherwise the UV transform maps the
 * coordinate and its derivatives first, so level, seam and tile are those of the transformed
 * coordinate; the filter word then picks the level and whether a level is read at the centre of
 * its texel or mixed by the sampler. Anisotropy averages `taps` reads along the longer axis of
 * the footprint at the level of the shorter one — once when it is hardly elongated
 * (`ANISOTROPY_SLACK`), `MAX_TAPS` at most. `tapOffset` places tap `i` of `n` on that line, for
 * the read and for the request alike.
 */
export const SAMPLING_WGSL = `/** How one sample reads: the coordinate after the texture's transform, the line anisotropy spreads
 *  its \`taps\` over, the level, and whether texels are picked rather than mixed. */
struct TileRead{uv:vec2f,axis:vec2f,lod:f32,taps:u32,nearest:bool,}
fn tapOffset(i:u32,n:u32)->f32{return (f32(i)+0.5)/f32(n)-0.5;}
/**
 * How a footprint reads a texture with a filter word, its coordinate and derivatives already
 * transformed. The level is the GPU's — the log of the longer gradient —, lowered by the
 * anisotropic ratio when \`aniso\` lets the texture's grant apply, clamped to its levels, then
 * rounded (\`nearest\` mip) or pinned to 0 (no mip). Magnification — a level at or under GL's
 * threshold, 0.5 with \`SAMPLE_MAG_HALF\`, 0 otherwise — reads level 0 with the magnification
 * filter, anything else the minification one. The taps are the footprint's elongation, rounded
 * up, capped by the grant and by \`MAX_TAPS\`.
 */
fn tileRead(s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,aniso:bool)->TileRead{
 let px=ddx*s.size;let py=ddy*s.size;
 let granted=((s.sampling>>${SAMPLE_ANISOTROPY_SHIFT}u)&15u)+1u;
 var raw=atlasLod(px,py);
 var taps=1u;var axis=vec2f(0.0);
 if(aniso&&granted>1u){
  let lx=dot(px,px);let ly=dot(py,py);
  let ratio=min(sqrt(max(lx,ly)/max(min(lx,ly),1e-20)),f32(granted));
  if(ratio>${1 + ANISOTROPY_SLACK}){
   raw-=log2(ratio);
   taps=min(u32(ceil(ratio-${ANISOTROPY_SLACK})),${MAX_TAPS}u);
   axis=select(ddy,ddx,lx>=ly);
  }
 }
 let mag=raw<=select(0.0,0.5,(s.sampling&${SAMPLE_MAG_HALF}u)!=0u);
 var lod=clamp(raw,0.0,f32(s.last));
 if(mag||(s.sampling&${SAMPLE_MIP_NONE}u)!=0u){lod=0.0;}
 else if((s.sampling&${SAMPLE_MIP_NEAREST}u)!=0u){lod=floor(lod+0.5);}
 let nearest=(s.sampling&select(${SAMPLE_MIN_NEAREST}u,${SAMPLE_MAG_NEAREST}u,mag))!=0u;
 return TileRead(uv,axis,lod,taps,nearest);
}
/** The centre of the texel a coordinate falls in, for a nearest read; the coordinate otherwise. */
fn pickTexel(texel:vec2f,nearest:bool)->vec2f{return select(texel,floor(texel)+0.5,nearest);}
/** One axis of a tap line folded once (\`foldLine\`): the folded centre, the direction the taps run
 *  in the folded period, and 1 when the whole line, half a texel around, stays in one period. */
fn foldAxis(t:f32,reach:f32,repeat:bool,mirror:bool)->vec3f{
 if(!repeat&&!mirror){return vec3f(t,1.0,select(0.0,1.0,t-reach>=0.0&&t+reach<=1.0));}
 let k=floor(t);
 let odd=mirror&&k-2.0*floor(k*0.5)>0.5;
 let inside=floor(t-reach)==k&&floor(t+reach)==k;
 return vec3f(select(t-k,1.0-(t-k),odd),select(1.0,-1.0,odd),select(0.0,1.0,inside));
}
/** A tap line folded once by its addressing: \`dir.x\` zero when it leaves its period or meets a
 *  seam, where each tap folds itself. */
struct FoldedLine{uv:vec2f,dir:vec2f,}
fn foldLine(r:TileRead,wrap:u32,size:vec2f)->FoldedLine{
 let reach=abs(r.axis)*0.5+0.5/size;
 let x=foldAxis(r.uv.x,reach.x,(wrap&${WRAP_S_REPEAT}u)!=0u,(wrap&${WRAP_S_MIRROR}u)!=0u);
 let y=foldAxis(r.uv.y,reach.y,(wrap&${WRAP_T_REPEAT}u)!=0u,(wrap&${WRAP_T_MIRROR}u)!=0u);
 return FoldedLine(vec2f(x.x,y.x),vec2f(x.y,y.y)*x.z*y.z);
}`;

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
}`;

/**
 * Public atlas read, `name(slot, uv, ddx, ddy, sampled)`: the header is read once, then a single
 * read off a seam, four mixed on the seam of a repeating period, where the sampler's rule would
 * mix the last texel and the first: it is the read that wraps, not the coordinate — by the
 * addressing nibble of the texture's header. `name + 'At'` is the read that `name` dispatches,
 * `name + 'Tap'` one read of it.
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
  const at = `${name}At`,
    tap = `${name}Tap`;
  const taps = anisotropic
    ? `fn ${name}Taps(s:TileSlot,r:TileRead)->${out}{
 let n=r.taps;
 let line=foldLine(r,s.wrap,s.size);
 if(line.dir.x==0.0){
  var sum=${out}();
  for(var i=0u;i<n;i++){sum+=${tap}(s,r.uv+r.axis*tapOffset(i,n),r.lod,r.nearest);}
  return sum/f32(n);
 }
 let step=r.axis*line.dir;
 let l0=floor(r.lod);let t=r.lod-l0;
 let a=${k}Line(s,line.uv,step,n,u32(l0),r.nearest);
 if(t<=0.0||l0>=f32(s.last)){return a;}
 return mix(a,${k}Line(s,line.uv,step,n,u32(l0)+1u,r.nearest),t);
}
`
    : '';
  return `fn ${tap}(s:TileSlot,uv:vec2f,lod:f32,nearest:bool)->${out}{
 if(!wrapRepete(s.wrap)){return ${at}(s,wrapReplie(uv,s.wrap),lod,nearest);}
 let t=wrapUv(uv,s.wrap,s.size);
 if(!t.couture||nearest){return ${at}(s,t.proche,lod,nearest);}
 let s00=${at}(s,t.proche,lod,nearest);
 let s10=${at}(s,vec2f(t.loin.x,t.proche.y),lod,nearest);
 let s01=${at}(s,vec2f(t.proche.x,t.loin.y),lod,nearest);
 let s11=${at}(s,t.loin,lod,nearest);
 return mix(mix(s00,s10,t.poids.x),mix(s01,s11,t.poids.x),t.poids.y);
}
${taps}fn ${name}Sampled(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f)->${out}{
 let r=${k}Footprint(slot,s,uv,ddx,ddy,${anisotropic});
${
  anisotropic
    ? ` if(r.taps>1u){return ${name}Taps(s,r);}
`
    : ''
} return ${tap}(s,r.uv,r.lod,r.nearest);
}
fn ${name}(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f,sampled:bool)->${out}{
 let s=${k}Slot(slot);
 if(sampled){return ${name}Sampled(slot,s,uv,ddx,ddy);}
 return ${tap}(s,uv,slotLod(s,ddx,ddy),false);
}`;
};
