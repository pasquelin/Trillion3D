import { WRAP_COORD_WGSL } from './visibilityWrapModes.ts';
import { POOL_LAYER_SIDE, TILE_BORDER, TILE_PITCH, TILE_SIZE } from './textureTiles.ts';
import { PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from './webgpuTilePageTable.ts';
import { MAX_LEVELS } from './textureTiles.ts';

/**
 * Les lectures de textures virtuelles partagées par toutes les passes : une indirection dans la
 * table de pages, puis un échantillon dans le pool. Le niveau se choisit comme la carte le
 * choisirait — le logarithme du plus grand des deux gradients — et le filtrage entre deux niveaux
 * se fait ici, par mélange, parce que le pool n'a pas de chaîne de mips : chaque niveau d'une
 * texture y vit dans ses propres tuiles.
 *
 * Une tuile absente ne s'invente pas : la table pointe l'ancêtre résident le plus fin, la queue en
 * dernier ressort, et la lecture est la même qu'avec la tuile — sur un niveau plus grossier. C'est
 * la perte déclarée du pool, jamais un texel de remplissage.
 *
 * Les coordonnées sont bornées au demi-texel du niveau lu : le filtrage linéaire ne sort donc jamais
 * des texels d'un niveau, ni d'une tuile de la queue vers sa voisine, et la couture d'une période en
 * répétition reste celle que `wrapUv` mêle à la main.
 *
 * Le nuanceur hôte déclare `colorPool`, `dataPool`, `mapsSampler`, `colorPages`, `dataPages` et,
 * s'il publie un retour d'image, `tileFeedback`, aux liaisons que `webgpuBindEntries.ts` publie.
 */
export const TILE_POOL_WGSL = `${WRAP_COORD_WGSL}
const TILE_SIZE:f32=${TILE_SIZE}.0;
const TILE_PITCH:f32=${TILE_PITCH}.0;
const TILE_BORDER:f32=${TILE_BORDER}.0;
const POOL_SIDE:f32=${POOL_LAYER_SIDE}.0;
const PAGE_HEADER:u32=${PAGE_HEADER_WORDS}u;
const PAGE_SLOT:u32=${PAGE_SLOT_WORDS}u;
const PAGE_LEVELS:u32=${MAX_LEVELS}u;
struct TileTap{uv:vec2f,layer:i32,}
fn atlasLod(px:vec2f,py:vec2f)->f32{return 0.5*log2(max(max(dot(px,px),dot(py,py)),1e-20));}
fn tailOffset(rank:u32)->f32{return select(TILE_SIZE-f32(${TILE_SIZE}u>>rank),0.0,rank==0u);}
fn placeOrigin(word:u32)->vec2f{return vec2f(f32(word&0xffu),f32((word>>8u)&0xffu))*TILE_PITCH+TILE_BORDER;}
fn placeLayer(word:u32)->i32{return i32((word>>16u)&0xffu);}
fn levelSize(size:vec2f,level:u32)->vec2f{return max(floor(size/exp2(f32(level))),vec2f(1.0));}
fn levelTexel(uv:vec2f,lsize:vec2f)->vec2f{return clamp(uv*lsize,vec2f(0.5),lsize-0.5);}
fn feedbackPhase(p:vec2f,word:u32)->bool{
 if((word&16u)!=0u){return true;}
 return ((u32(p.x)&3u)|((u32(p.y)&3u)<<2u))==(word&15u);
}`;

/**
 * Les lectures d'un atlas, engendrées par nom : le tampon `${k}Pages` et le pool `${k}Pool` ne se
 * passent pas en argument en WGSL, donc chaque atlas a ses fonctions, du même texte.
 */
const kind = (k: string) => `fn ${k}Size(slot:u32)->vec2f{
 let w=${k}Pages[PAGE_HEADER+slot*PAGE_SLOT];return vec2f(f32(w&0xffffu),f32(w>>16u));
}
fn ${k}Texels(slot:u32)->vec2f{return ${k}Size(slot);}
fn ${k}Entry(slot:u32,level:u32,tile:vec2u,tw:u32)->u32{
 return ${k}Pages[${k}Pages[3]+slot*PAGE_LEVELS+level]+tile.y*tw+tile.x;
}
fn ${k}Tap(slot:u32,uv:vec2f,level:u32)->TileTap{
 let header=PAGE_HEADER+slot*PAGE_SLOT;
 let size=${k}Size(slot);
 let tail=${k}Pages[header+1u];
 var word=0u;
 if(level<tail){
  let lsize=levelSize(size,level);
  let texel=levelTexel(uv,lsize);
  word=${k}Pages[${k}Entry(slot,level,vec2u(texel/TILE_SIZE),u32(ceil(lsize.x/TILE_SIZE)))];
 }
 if(word==0u){
  let res=max(level,tail);
  let rtexel=levelTexel(uv,levelSize(size,res));
  let tailWord=${k}Pages[header+3u];
  let origin=placeOrigin(tailWord)+vec2f(tailOffset(res-tail),0.0);
  return TileTap((origin+rtexel)/POOL_SIDE,placeLayer(tailWord));
 }
 let res=(word>>24u)&0x7fu;
 let rtexel=levelTexel(uv,levelSize(size,res));
 let local=rtexel-floor(rtexel/TILE_SIZE)*TILE_SIZE;
 return TileTap((placeOrigin(word)+local)/POOL_SIDE,placeLayer(word));
}
fn ${k}Fetch(slot:u32,uv:vec2f,level:u32)->vec4f{
 let t=${k}Tap(slot,uv,level);return textureSampleLevel(${k}Pool,mapsSampler,t.uv,t.layer,0.0);
}
fn ${k}SampleAt(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f{
 let size=${k}Size(slot);
 let last=f32(${k}Pages[PAGE_HEADER+slot*PAGE_SLOT+2u]);
 let lod=clamp(atlasLod(ddx*size,ddy*size),0.0,last);
 let l0=floor(lod);let t=lod-l0;
 let a=${k}Fetch(slot,uv,u32(l0));
 if(t<=0.0||l0>=last){return a;}
 return mix(a,${k}Fetch(slot,uv,u32(l0)+1u),t);
}`;

/** Le retour d'image d'un atlas : `${k}Feedback(slot, uv, wrap, ddx, ddy)` compte la tuile que ce
 *  pixel demande, et la suivante quand le niveau tombe entre deux. Seules les passes qui publient
 *  un retour l'insèrent : il nomme `tileFeedback`. */
const feedback = (k: string) => `fn ${k}Request(slot:u32,uv:vec2f,level:u32){
 let header=PAGE_HEADER+slot*PAGE_SLOT;
 if(level>=${k}Pages[header+1u]){return;}
 let lsize=levelSize(${k}Size(slot),level);
 let texel=levelTexel(uv,lsize);
 let entry=${k}Entry(slot,level,vec2u(texel/TILE_SIZE),u32(ceil(lsize.x/TILE_SIZE)));
 atomicAdd(&tileFeedback[entry-${k}Pages[2]+${k}Pages[0]],1u);
}
fn ${k}Wrapped(slot:u32,uv:vec2f,wrap:u32)->vec2f{
 if(!wrapRepete(wrap)){return wrapReplie(uv,wrap);}
 return wrapUv(uv,wrap,${k}Texels(slot)).proche;
}
fn ${k}Feedback(slot:u32,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f){
 let header=PAGE_HEADER+slot*PAGE_SLOT;
 if(${k}Pages[header+1u]==0u){return;}
 let size=${k}Size(slot);
 let lod=clamp(atlasLod(ddx*size,ddy*size),0.0,f32(${k}Pages[header+2u]));
 let w=${k}Wrapped(slot,uv,wrap);
 let l0=u32(floor(lod));
 ${k}Request(slot,w,l0);
 if(lod-floor(lod)>0.0){${k}Request(slot,w,l0+1u);}
}`;

/**
 * La lecture publique d'un atlas : `wrap` est le quartet d'adressage de la carte lue. Une seule
 * lecture hors couture, quatre mêlées sur la couture d'une période en répétition, où la règle de
 * l'échantillonneur mêlerait le dernier texel et le premier : c'est la lecture qui reboucle, pas la
 * coordonnée. `name + 'At'` est la lecture que `name` dispatche.
 */
const wrapped = (name: string, texels: string, args: string, call: string, out: string) => {
  const at = `${name}At`;
  return `fn ${name}(slot:u32,uv:vec2f,wrap:u32${args})->${out}{
 if(!wrapRepete(wrap)){return ${at}(slot,wrapReplie(uv,wrap)${call});}
 let t=wrapUv(uv,wrap,${texels}(slot));
 if(!t.couture){return ${at}(slot,t.proche${call});}
 let s00=${at}(slot,t.proche${call});
 let s10=${at}(slot,vec2f(t.loin.x,t.proche.y)${call});
 let s01=${at}(slot,vec2f(t.proche.x,t.loin.y)${call});
 let s11=${at}(slot,t.loin${call});
 return mix(mix(s00,s10,t.poids.x),mix(s01,s11,t.poids.x),t.poids.y);
}`;
};

/** Retour d'image des deux atlas : `colorFeedback(...)` et `dataFeedback(...)`. */
export const TILE_FEEDBACK_WGSL = `${feedback('color')}
${feedback('data')}`;

/** Lecture de l'atlas couleur : `colorSample(slot, uv, wrap, ddx, ddy)`. */
export const COLOR_SAMPLE_WGSL = `${kind('color')}
${wrapped('colorSample', 'colorTexels', ',ddx:vec2f,ddy:vec2f', ',ddx,ddy', 'vec4f')}`;

/** Découpe alpha de l'atlas couleur, sur la tuile la plus fine résidente : `colorAlpha(slot, uv, wrap)`. */
export const COLOR_ALPHA_WGSL = `${kind('color')}
fn colorAlphaAt(slot:u32,uv:vec2f)->f32{return colorFetch(slot,uv,0u).w;}
${wrapped('colorAlpha', 'colorTexels', '', '', 'f32')}`;

/** Lecture de l'atlas de données : `dataSample(slot, uv, wrap, ddx, ddy)`. */
export const DATA_SAMPLE_WGSL = `${kind('data')}
${wrapped('dataSample', 'dataTexels', ',ddx:vec2f,ddy:vec2f', ',ddx,ddy', 'vec4f')}`;

/** Les déclarations d'un atlas : son pool et sa table de pages, aux liaisons que la disposition donne. */
export const tileDeclarations = (bindings: { pool: number; pages: number }, name: string) =>
  `@group(0) @binding(${bindings.pool}) var ${name}Pool:texture_2d_array<f32>;
@group(0) @binding(${bindings.pages}) var<storage,read> ${name}Pages:array<u32>;`;

/** La déclaration du retour d'image : un compteur atomique par tuile diffusée des deux atlas. */
export const feedbackDeclaration = (binding: number) =>
  `@group(0) @binding(${binding}) var<storage,read_write> tileFeedback:array<atomic<u32>>;`;
