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
 * la perte déclarée du pool, jamais un texel de remplissage. La passe d'ombres seule lit `finest` :
 * une tuile absente à son niveau lit la tuile résidente la plus fine sous ce texel — celle que la
 * caméra a fait venir —, jamais la queue tant qu'il y en a une, pour que l'ombre d'une feuille que
 * personne n'a demandée à son niveau reste une feuille et non une tache de 64 texels.
 *
 * L'en-tête d'une texture — taille, queue, dernier niveau, début de ses niveaux — se lit UNE fois
 * par échantillon (`TileSlot`), pas une fois par prise : les deux prises d'un mélange n'ajoutent
 * chacune que l'adresse de leur niveau et leur entrée. Sur un pixel de feuillage, c'est la
 * différence entre une chaîne de douze lectures dépendantes et une de huit.
 *
 * Les coordonnées sont bornées au demi-texel du niveau lu : le filtrage linéaire ne sort donc jamais
 * des texels d'un niveau, ni d'une tuile de la queue vers sa voisine, et la couture d'une période en
 * répétition reste celle que `wrapUv` mêle à la main.
 *
 * Le nuanceur hôte déclare `colorPool`, `dataPool`, `mapsSampler`, `colorPages`, `dataPages` et,
 * s'il publie un retour d'image, `tileFeedback`, aux liaisons que `webgpuBindEntries.ts` publie.
 */
export const TILE_POOL_WGSL = `${WRAP_COORD_WGSL}
const TEXEL_TILE:f32=${TILE_SIZE}.0;
const TEXEL_PITCH:f32=${TILE_PITCH}.0;
const TEXEL_BORDER:f32=${TILE_BORDER}.0;
const POOL_SIDE:f32=${POOL_LAYER_SIDE}.0;
const PAGE_HEADER:u32=${PAGE_HEADER_WORDS}u;
const PAGE_SLOT:u32=${PAGE_SLOT_WORDS}u;
const PAGE_LEVELS:u32=${MAX_LEVELS}u;
struct TileTap{uv:vec2f,layer:i32,}
/** L'en-tête d'une texture : sa taille, son premier niveau de queue, son dernier niveau, le mot où
 *  commencent les adresses de ses niveaux, et son en-tête même — la place de sa queue s'y relit. */
struct TileSlot{size:vec2f,tail:u32,last:u32,levels:u32,header:u32,}
fn atlasLod(px:vec2f,py:vec2f)->f32{return 0.5*log2(max(max(dot(px,px),dot(py,py)),1e-20));}
/** Le niveau qu'une empreinte demande à une texture, borné à ses niveaux : la règle unique du choix
 *  de niveau, pour la lecture comme pour la demande. */
fn slotLod(s:TileSlot,ddx:vec2f,ddy:vec2f)->f32{return clamp(atlasLod(ddx*s.size,ddy*s.size),0.0,f32(s.last));}
/** La coordonnée ramenée dans la texture par son quartet d'adressage, côté proche d'une couture. */
fn slotWrapped(s:TileSlot,uv:vec2f,wrap:u32)->vec2f{
 if(!wrapRepete(wrap)){return wrapReplie(uv,wrap);}
 return wrapUv(uv,wrap,s.size).proche;
}
fn tailOffset(rank:u32)->f32{return select(TEXEL_TILE-f32(${TILE_SIZE}u>>rank),0.0,rank==0u);}
fn placeOrigin(word:u32)->vec2f{return vec2f(f32(word&0xffu),f32((word>>8u)&0xffu))*TEXEL_PITCH+TEXEL_BORDER;}
fn placeLayer(word:u32)->i32{return i32((word>>16u)&0xffu);}
fn sizeOf(word:u32)->vec2f{return vec2f(f32(word&0xffffu),f32(word>>16u));}
fn levelSize(size:vec2f,level:u32)->vec2f{return max(floor(size/exp2(f32(level))),vec2f(1.0));}
fn levelTexel(uv:vec2f,lsize:vec2f)->vec2f{return clamp(uv*lsize,vec2f(0.5),lsize-0.5);}
/** L'entrée d'un texel dans son niveau : sa tuile, en lignes de tuiles. */
fn tileEntry(texel:vec2f,lsize:vec2f)->u32{return u32(texel.y/TEXEL_TILE)*u32(ceil(lsize.x/TEXEL_TILE))+u32(texel.x/TEXEL_TILE);}
fn feedbackPhase(p:vec2f,word:u32)->bool{
 if((word&16u)!=0u){return true;}
 return ((u32(p.x)&3u)|((u32(p.y)&3u)<<2u))==(word&15u);
}`;

/**
 * Les lectures d'un atlas, engendrées par nom : le tampon `${k}Pages` et le pool `${k}Pool` ne se
 * passent pas en argument en WGSL, donc chaque atlas a ses fonctions, du même texte.
 */
const kind = (k: string) => `fn ${k}Slot(slot:u32)->TileSlot{
 let header=PAGE_HEADER+slot*PAGE_SLOT;
 return TileSlot(sizeOf(${k}Pages[header]),${k}Pages[header+1u],${k}Pages[header+2u],${k}Pages[3]+slot*PAGE_LEVELS,header);
}
fn ${k}Texels(slot:u32)->vec2f{return sizeOf(${k}Pages[PAGE_HEADER+slot*PAGE_SLOT]);}
/** Le mot de la table où vit la tuile d'un texel à un niveau diffusé. */
fn ${k}Entry(s:TileSlot,uv:vec2f,level:u32)->u32{
 let lsize=levelSize(s.size,level);
 return ${k}Pages[s.levels+level]+tileEntry(levelTexel(uv,lsize),lsize);
}
/** Où lire un texel dont le mot est connu : la tuile qu'il nomme, ou la queue au niveau demandé. */
fn ${k}Place(s:TileSlot,uv:vec2f,level:u32,word:u32)->TileTap{
 if(word==0u){
  let res=max(level,s.tail);
  let rtexel=levelTexel(uv,levelSize(s.size,res));
  let tailWord=${k}Pages[s.header+3u];
  let origin=placeOrigin(tailWord)+vec2f(tailOffset(res-s.tail),0.0);
  return TileTap((origin+rtexel)/POOL_SIDE,placeLayer(tailWord));
 }
 let res=(word>>24u)&0x7fu;
 let rtexel=levelTexel(uv,levelSize(s.size,res));
 let local=rtexel-floor(rtexel/TEXEL_TILE)*TEXEL_TILE;
 return TileTap((placeOrigin(word)+local)/POOL_SIDE,placeLayer(word));
}
fn ${k}Fetch(s:TileSlot,uv:vec2f,level:u32,finest:bool)->vec4f{
 var word=0u;
 if(level<s.tail){
  word=${k}Pages[${k}Entry(s,uv,level)];
  if(finest&&word==0u){word=${k}Pages[${k}Entry(s,uv,0u)];}
 }
 let t=${k}Place(s,uv,level,word);
 return textureSampleLevel(${k}Pool,mapsSampler,t.uv,t.layer,0.0);
}
/** La lecture filtrée : les deux niveaux que l'empreinte encadre, mêlés par leur part. */
fn ${k}Blend(s:TileSlot,uv:vec2f,ddx:vec2f,ddy:vec2f,finest:bool)->vec4f{
 let lod=slotLod(s,ddx,ddy);
 let l0=floor(lod);let t=lod-l0;
 let a=${k}Fetch(s,uv,u32(l0),finest);
 if(t<=0.0||l0>=f32(s.last)){return a;}
 return mix(a,${k}Fetch(s,uv,u32(l0)+1u,finest),t);
}
fn ${k}SampleAt(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f{return ${k}Blend(${k}Slot(slot),uv,ddx,ddy,false);}`;

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

/** Lecture de l'atlas couleur : `colorSample(slot, uv, wrap, ddx, ddy)`. */
export const COLOR_SAMPLE_WGSL = `${kind('color')}
${wrapped('colorSample', 'colorTexels', ',ddx:vec2f,ddy:vec2f', ',ddx,ddy', 'vec4f')}`;

/**
 * La découpe d'un matériau à masque : `maskAlpha(slot, uv, wrap, ddx, ddy)`, l'alpha de la carte de
 * base lu exactement comme la passe matériaux lit sa couleur — même niveau, même mélange —, aux
 * dérivées de la passe qui lit. `finest` est la règle de repli de la passe d'ombres (voir en-tête) ;
 * le raster de la caméra ne l'a pas : ses tuiles sont celles qu'il a demandées. Exige
 * `COLOR_SAMPLE_WGSL`.
 */
export const maskAlphaWgsl = (finest: boolean) =>
  `fn maskAlphaAt(slot:u32,uv:vec2f,ddx:vec2f,ddy:vec2f)->f32{return colorBlend(colorSlot(slot),uv,ddx,ddy,${finest}).w;}
${wrapped('maskAlpha', 'colorTexels', ',ddx:vec2f,ddy:vec2f', ',ddx,ddy', 'f32')}`;

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
