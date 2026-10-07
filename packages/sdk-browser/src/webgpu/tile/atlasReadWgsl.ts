import { TILE_READ_WGSL } from '../../texture/samplingFootprint.ts'
import { SAMPLE_TRANSFORMED } from '../../texture/sampling.ts'
import { SAMPLING_WGSL } from './samplingWgsl.ts'
import { tileKindWgsl } from './kindWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The footprint read of atlas `k` through the texture's filter rule, and through its UV
 *  transform when it has one, whose words the transform flag alone fetches: `${k}Footprint`, the
 *  filter rule through the affine 2 × 3 matrix (`Texture.transform`), on the coordinate and on its
 *  derivatives — a zero filter word reads as the default read does —, then the taps, on the
 *  textures of `pool` (`tilePoolWgsl`), which provides the footprint rule `tileRead` at its level
 *  offset. */
export const samplingReadWgsl = (k: string, pool: WgslDecl) =>
  wgslBlock(
    `samplingReadWgsl(${k})`,
    [pool, TILE_READ_WGSL, tileKindWgsl(k, pool)],
    `fn ${k}Footprint(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,aniso:bool)->TileRead{
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
}`,
  )

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
 *
 * On the textures of `pool` (`tilePoolWgsl`); `level` declares its read at a level,
 * `name + 'At'`.
 */
export const atlasReadWgsl = (
  name: string,
  k: string,
  out: string,
  anisotropic: boolean,
  { pool, level }: { pool: WgslDecl; level: WgslDecl },
) => {
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
  return wgslBlock(
    `atlasReadWgsl(${name}, ${k}, ${out}, ${anisotropic})`,
    [pool, SAMPLING_WGSL, TILE_READ_WGSL, tileKindWgsl(k, pool), samplingReadWgsl(k, pool), level],
    `${taps}fn ${name}Sampled(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f)->${out}{
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
}`,
  )
}
