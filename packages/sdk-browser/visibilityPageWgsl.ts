import * as THREE from 'three';
import {
  WRAP_MAP,
  WRAP_OF_WGSL,
  WRAP_S_MIRROR,
  WRAP_S_REPEAT,
  WRAP_T_MIRROR,
  WRAP_T_REPEAT,
} from './visibilityWrapModes.ts';
import { VIS_BINDINGS } from './webgpuBindLayout.ts';

/**
 * La géométrie d'une page telle que le GPU la lit : la description d'un cluster, l'uniforme de son
 * slot de dessin, et la résolution du rang de page d'une instance indirecte. Une seule déclaration,
 * partagée par le raster du visibility buffer et par les passes de profondeur des ombres — deux
 * copies de cette structure seraient deux chances de la voir dériver.
 */
export const PAGE_INFO_STRUCT_WGSL = `struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,uvScale:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,roughUvScale:vec2f,metalUvScale:vec2f,normalUvScale:vec2f,aoIndex:u32,aoIntensity:f32,aoUvScale:vec2f,emissiveIndex:u32,selectionIndex:u32,emissive:vec4f,emissiveUvScale:vec2f,normalScaleY:f32,pad1:f32,pad4:vec4f,depthBias:u32,wrapModes:u32,pad5c:u32,pad5d:u32,}`;

/** La description d'un cluster, suivie de l'uniforme d'une passe de géométrie de page. */
export const PAGE_INFO_WGSL = `${PAGE_INFO_STRUCT_WGSL}
struct Uniforms{viewProj:mat4x4f,viewport:vec2f,smallThreshold:f32,pad:f32,drawSlot:u32,indirect:u32,selectionOffset:u32,selectionEnabled:u32,}`;

/**
 * Les liaisons qu'une passe de géométrie de page partage, une par ligne. Elles sont nommées plutôt
 * que regroupées pour que chaque passe les compose dans son propre ordre : le raster du visibility
 * buffer garde ainsi, au caractère près, le texte de shader qu'il avait avant les ombres.
 */
export const PAGE_BINDING = {
  indices: `@group(0) @binding(${VIS_BINDINGS.cache}) var<storage, read> indices:array<u32>;`,
  positions: `@group(0) @binding(${VIS_BINDINGS.position}) var<storage, read> positions:array<f32>;`,
  pages: `@group(0) @binding(${VIS_BINDINGS.pageTable}) var<storage, read> pages:array<PageInfo>;`,
  uniforms: `@group(0) @binding(${VIS_BINDINGS.uniform}) var<uniform> uni:Uniforms;`,
  instances: `@group(0) @binding(${VIS_BINDINGS.instances}) var<storage, read> instances:array<u32>;`,
  slotOffsets: `@group(0) @binding(${VIS_BINDINGS.slotOffsets}) var<storage, read> slotOffsets:array<u32>;`,
} as const;

/** Rang de page d'une instance : direct en dessin explicite, via la table des slots en indirect. */
export const PAGE_LOOKUP_WGSL = `fn drawPage(instanceIndex:u32)->u32{
 if(uni.indirect!=0u){return instances[slotOffsets[uni.drawSlot]+instanceIndex];}
 return instanceIndex;
}`;

/** Position d'un sommet de page dans son espace local. */
export const PAGE_VERTEX_WGSL = `fn vertPos(base:u32,idx:u32)->vec3f{let i=(base+idx)*3u;return vec3f(positions[i],positions[i+1u],positions[i+2u]);}`;

/** Coordonnée de texture d'un sommet de page. */
export const PAGE_UV_WGSL = `fn vertUv(base:u32,idx:u32)->vec2f{let i=(base+idx)*2u;return vec2f(uvs[i],uvs[i+1u]);}`;

/**
 * La coordonnée de texture ramenée dans [0, 1] selon le mode de chaque axe, pour un échantillonneur
 * en serrage. Le miroir lit les périodes impaires à rebours : `p` parcourt [0, 2) et `2 - p` est
 * exact, donc le filtrage linéaire rend la couleur de l'échantillonneur `mirror-repeat` de Three.
 *
 * `wrapUv` reçoit le quartet de la carte lue, pas les drapeaux du matériau : la couleur d'une page
 * peut se répéter là où ses normales se serrent (`visibilityWrapModes.ts`).
 *
 * Replier la coordonnée suffit au plus proche et au miroir, jamais à la répétition en filtrage
 * linéaire : dans le demi-texel des deux bords d'une période, la règle de l'échantillonneur mêle le
 * dernier texel et le premier, que le repli sépare. `wrapUv` rend donc les deux prises et leur
 * poids — `proche` seule hors couture, puis `loin` et `poids` sur la couture, où l'appelant mêle
 * lui-même les quatre lectures. `proche` reste le texel que le repli désignait, donc une lecture au
 * plus proche ne bouge pas ; les deux prises tombent au centre exact d'un texel de bord, si bien que
 * la lecture ne dépend plus de l'interpolation de la carte mais du mélange que l'appelant écrit.
 */
export const WRAP_COORD_WGSL = `${WRAP_OF_WGSL}
fn wrapCoord(t:f32,repeat:bool,mirror:bool)->f32{
 let p=t-2.0*floor(t*0.5);
 return select(select(clamp(t,0.0,1.0),fract(t),repeat),select(p,2.0-p,p>1.0),mirror);
}
struct WrapTaps{proche:vec2f,loin:vec2f,poids:vec2f,couture:bool,}
fn wrapAxis(t:f32,repeat:bool,mirror:bool,texels:f32)->vec4f{
 let c=wrapCoord(t,repeat,mirror);
 let demi=0.5/texels;
 if(!repeat||(c>=demi&&c<=1.0-demi)){return vec4f(c,c,0.0,0.0);}
 let g=fract(c*texels+0.5);
 return vec4f(select(1.0-demi,demi,c<demi),select(demi,1.0-demi,c<demi),min(g,1.0-g),1.0);
}
fn wrapUv(uv:vec2f,wrap:u32,texels:vec2f)->WrapTaps{
 let x=wrapAxis(uv.x,(wrap&${WRAP_S_REPEAT}u)!=0u,(wrap&${WRAP_S_MIRROR}u)!=0u,texels.x);
 let y=wrapAxis(uv.y,(wrap&${WRAP_T_REPEAT}u)!=0u,(wrap&${WRAP_T_MIRROR}u)!=0u,texels.y);
 return WrapTaps(vec2f(x.x,y.x),vec2f(x.y,y.y),vec2f(x.z,y.z),x.w+y.w>0.0);
}`;

/**
 * Miroir processeur de `wrapAxis`, juste au-dessus : les deux texels qu'un filtrage linéaire mêle
 * sur un axe de `size` texels, le plus proche d'abord, et le poids du second. Hors de la couture
 * d'une période, ce sont les voisins que l'échantillonneur en serrage donne déjà, bornés comme il
 * les borne ; sur la couture en répétition, la règle de l'échantillonneur mêle le dernier texel et
 * le premier, que le repli de la coordonnée sépare — les prises rebouclent alors la période.
 * Deux langages, une règle : le texte de nuanceur ne se partage pas avec TypeScript.
 */
export function wrapLinear(
  t: number,
  size: number,
  wrap: THREE.Wrapping,
): [number, number, number] {
  const repeat = wrap === THREE.RepeatWrapping;
  const p = wrap === THREE.MirroredRepeatWrapping ? t - 2 * Math.floor(t / 2) : 0;
  const c = repeat
    ? t - Math.floor(t)
    : wrap === THREE.ClampToEdgeWrapping
      ? Math.min(1, Math.max(0, t))
      : p > 1
        ? 2 - p
        : p;
  const demi = 0.5 / size;
  if (repeat && (c < demi || c > 1 - demi)) {
    const u = c * size + 0.5,
      g = u - Math.floor(u);
    return c < demi ? [0, size - 1, 1 - g] : [size - 1, 0, g];
  }
  const centre = c * size - 0.5,
    bas = Math.floor(centre);
  const borne = (i: number) => Math.min(size - 1, Math.max(0, i));
  return [borne(bas), borne(bas + 1), centre - bas];
}

/** Aire signée du triangle `(a,b,p)` en coordonnées écran ; le raster en tire ses barycentriques. */
export const EDGE_WGSL = `fn edge(a:vec2f,b:vec2f,p:vec2f)->f32{return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}`;

/**
 * Les trois poids barycentriques affines du point `p`, l'aire signée étant déjà connue. Le raster
 * des petits triangles et l'ombrage du tampon de visibilité posaient le même quotient chacun de son
 * côté ; c'est le même triangle qu'ils pondèrent, il n'en existe qu'une écriture. Exige `EDGE_WGSL`.
 */
export const BARY_WEIGHTS_WGSL = `fn baryWeights(a:vec2f,b:vec2f,c:vec2f,p:vec2f,area:f32)->vec3f{
 let w0=edge(b,c,p)/area;let w1=edge(c,a,p)/area;
 return vec3f(w0,w1,1.0-w0-w1);
}`;

/**
 * La coordonnée de texture d'un sommet et le test de masque d'opacité d'un cluster, tels que le
 * raster du tampon de visibilité et la passe de profondeur des ombres les appliquent tous les deux.
 * Une seule écriture : une découpe qui ne serait pas la même des deux côtés ferait une ombre qui ne
 * correspond pas à la silhouette qu'on voit. `flags` : 4 = UV présentes, 8 = carte de base,
 * 128 = matériau à masque ; le seuil est `baseColor.w`, et le mode d'adressage de la carte de base
 * vient du mot par carte, jamais des drapeaux du matériau.
 *
 * Le shader hôte déclare `uvs`, l'atlas couleur et sa table de slots, puis insère `ATLAS_SLOTS_WGSL`
 * (qui porte la règle d'adressage) et `COLOR_ALPHA_WGSL` avant ce bloc : `colorAlpha` y applique
 * l'adressage de la page et lit le niveau le plus fin déjà résident.
 */
export const MASK_KEEP_WGSL = `fn maskKeep(page:PageInfo,uv:vec2f)->bool{
 if((page.flags&128u)==0u||(page.flags&8u)==0u){return true;}
 // Chaque niveau progressif préserve la couverture du seuil, donc la découpe est juste dès le
 // premier niveau reçu ; une couche prête relit le niveau 0, exactement comme avant ce lot.
 return colorAlpha(page.mapIndex,page.uvScale,uv,wrapOf(page.wrapModes,${WRAP_MAP.base}u))>=page.baseColor.w;
}`;

/** Le test de masque précédé de la coordonnée de texture qu'un sommet de page lui fournit. */
export const PAGE_MASK_WGSL = `${PAGE_UV_WGSL}
${MASK_KEEP_WGSL}`;
