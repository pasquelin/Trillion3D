import { TILE_READ_WGSL } from '../../texture/samplingFootprint.ts'
import { SAMPLE_TRANSFORMED } from '../../texture/sampling.ts'
import { SAMPLING_WGSL } from './samplingWgsl.ts'
import { tileKindWgsl } from './kindWgsl.ts'
import { type WgslDecl, wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The footprint read of atlas `k` through the texture's filter rule, and through its UV
 *  transform when it has one, whose words the transform flag alone fetches (`${k}UvTransform`, the
 *  one read of them, which the physical lobes' frame also calls): `${k}Footprint`, the
 *  filter rule through the affine 2 × 3 matrix (`Texture.transform`), on the coordinate and on its
 *  derivatives — a zero filter word reads as the default read does —, then the taps, on the
 *  textures of `pool` (`tilePoolWgsl`), which provides the footprint rule `tileRead` at its level
 *  offset. */
export const samplingReadWgsl = (k: string, pool: WgslDecl) =>
  wgslBlock(
    `samplingReadWgsl(${k})`,
    [pool, TILE_READ_WGSL, tileKindWgsl(k, pool)],
    `/** Slot \`slot\`'s UV transform (\`Texture.transform\`): its linear part in the first two
 *  columns, its translation in the third; read only under the transform flag. */
fn ${k}UvTransform(slot:u32)->mat3x2f{
 let h=PAGE_HEADER+slot*PAGE_SLOT+PAGE_TRANSFORM;
 return mat3x2f(bitcast<f32>(${k}Pages[h]),bitcast<f32>(${k}Pages[h+1u]),bitcast<f32>(${k}Pages[h+2u]),bitcast<f32>(${k}Pages[h+3u]),bitcast<f32>(${k}Pages[h+4u]),bitcast<f32>(${k}Pages[h+5u]));
}
fn ${k}Footprint(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,aniso:bool)->TileRead{
 if((s.sampling&${SAMPLE_TRANSFORMED}u)==0u){return tileRead(s,uv,ddx,ddy,aniso);}
 let x=${k}UvTransform(slot);let m=mat2x2f(x[0],x[1]);
 return tileRead(s,m*uv+x[2],m*ddx,m*ddy,aniso);
}
/** The taps of one level along the footprint's axis, each brought back by the texture's
 *  addressing as \`${k}Level\` brings one: a tap on the seam of a repeating period, unless nearest,
 *  mixes its four texels (\`${k}Level\`); any other reads one texel through its tile's table word,
 *  the level's table base and size taken once for the line and the word read again only where a
 *  tap enters another tile. A camera footprint's line: no finest fallback. */
fn ${k}Line(s:TileSlot,r:TileRead,level:u32)->vec4f{
 let n=r.taps;let lsize=levelSize(s.size,level);let streamed=level<s.tail;
 var base=0u;if(streamed){base=${k}Pages[s.levels+level];}
 var tile=0xffffffffu;var word=0u;var sum=vec4f(0.0);
 for(var i=0u;i<n;i++){
  let uv=r.uv+r.axis*tapOffset(i,n);
  var at=wrapReplie(uv,s.wrap);
  if(wrapRepete(s.wrap)){
   let w=wrapUv(uv,s.wrap,lsize);
   if(w.couture&&!r.nearest){sum+=${k}Level(s,uv,level,false,false);continue;}
   at=w.proche;
  }
  if(streamed){let e=tileEntry(levelTexel(at,lsize),lsize);if(e!=tile){tile=e;word=${k}Pages[base+e];}}
  sum+=${k}Tap(s.tap,${k}Place(s,at,level,word,r.nearest));
 }
 return sum/f32(n);
}`,
  )

/** What a reading pass asks of its footprint: the anisotropic taps its elongation asks (the
 *  camera's), and the finest fallback of a level not resident (a shadow texel's, one tap at the
 *  isotropic level). */
export type Footprint = { readonly anisotropic: boolean; readonly finest: boolean }

/**
 * Public atlas read, `name(slot, uv, ddx, ddy, sampled)`, of the footprint `footprint` the pass
 * gives: the header is read once, then each level read wraps by the addressing nibble of the
 * texture's header (`${k}Level`, `kindWgsl.ts`) — a single fetch off a seam, four mixed on the seam
 * of a repeating period at that level's size, where the sampler's rule would mix the last texel and
 * the first: it is the read that wraps, not the coordinate. `name + 'At'`, written here, is one read
 * at a level of detail (`${k}Blend` under the footprint's fallback), which `name` dispatches.
 *
 * `sampled` is the page's or the item's, never the texture's: a class override in the resolve
 * (`HAS_SAMPLING`), which the compiler folds, a flag of the draw elsewhere (`FLAG_SAMPLED`). False,
 * the read is the default one and nothing more: the level of the footprint, texels mixed. True,
 * every map of the material goes through its transform and filter rule (`${k}Footprint`): a
 * nearest read takes the texel the fold named, seam or not, and an anisotropic footprint averages
 * its taps, one tap loop per level (`${k}Line`), the two levels mixed once. On the textures of
 * `pool` (`tilePoolWgsl`).
 */
export const atlasReadWgsl = (
  name: string,
  k: string,
  pool: WgslDecl,
  { anisotropic, finest }: Footprint,
) => {
  const at = `${name}At`
  const taps = anisotropic
    ? `fn ${name}Taps(s:TileSlot,r:TileRead)->vec4f{
 let l0=floor(r.lod);let t=r.lod-l0;
 let a=${k}Line(s,r,u32(l0));
 if(t<=0.0||l0>=f32(s.last)){return a;}
 return mix(a,${k}Line(s,r,u32(l0)+1u),t);
}
`
    : ''
  return wgslBlock(
    `atlasReadWgsl(${name}, ${k}, ${anisotropic}, ${finest})`,
    [pool, SAMPLING_WGSL, TILE_READ_WGSL, tileKindWgsl(k, pool), samplingReadWgsl(k, pool)],
    `${taps}fn ${at}(s:TileSlot,uv:vec2f,lod:f32,nearest:bool)->vec4f{return ${k}Blend(s,uv,lod,nearest,${finest});}
fn ${name}Sampled(slot:u32,s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f{
 let r=${k}Footprint(slot,s,uv,ddx,ddy,${anisotropic});
${
  anisotropic
    ? ` if(r.taps>1u){return ${name}Taps(s,r);}
`
    : ''
} return ${at}(s,r.uv,r.lod,r.nearest);
}
fn ${name}(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f,sampled:bool)->vec4f{
 let s=${k}Slot(slot);
 if(sampled){return ${name}Sampled(slot,s,uv,ddx,ddy);}
 return ${at}(s,uv,slotLod(s,ddx,ddy),false);
}`,
  )
}
