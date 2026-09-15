import { VIS_BINDINGS } from './webgpuBindLayout.ts';

/**
 * La géométrie d'une page telle que le GPU la lit : la description d'un cluster, l'uniforme de son
 * slot de dessin, et la résolution du rang de page d'une instance indirecte. Une seule déclaration,
 * partagée par le raster du visibility buffer et par les passes de profondeur des ombres — deux
 * copies de cette structure seraient deux chances de la voir dériver.
 */
export const PAGE_INFO_WGSL = `struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,uvScale:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,roughUvScale:vec2f,metalUvScale:vec2f,normalUvScale:vec2f,aoIndex:u32,aoIntensity:f32,aoUvScale:vec2f,emissiveIndex:u32,selectionIndex:u32,emissive:vec4f,emissiveUvScale:vec2f,normalScaleY:f32,pad1:f32,pad4:vec4f,depthBias:u32,pad5b:u32,pad5c:u32,pad5d:u32,}
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

/**
 * La coordonnée de texture d'un sommet et le test de masque d'opacité d'un cluster, tels que le
 * raster du tampon de visibilité et la passe de profondeur des ombres les appliquent tous les deux.
 * Une seule écriture : une découpe qui ne serait pas la même des deux côtés ferait une ombre qui ne
 * correspond pas à la silhouette qu'on voit. `flags` : 4 = UV présentes, 8 = carte de base,
 * 32/64 = répétition en S/T, 128 = matériau à masque ; le seuil est `baseColor.w`.
 *
 * Le shader hôte déclare `uvs`, l'atlas couleur et sa table de slots, puis insère `ATLAS_SLOTS_WGSL`
 * et `COLOR_ALPHA_WGSL` avant ce bloc : `colorAlpha` y lit le niveau le plus fin déjà résident.
 */
export const PAGE_MASK_WGSL = `fn vertUv(base:u32,idx:u32)->vec2f{let i=(base+idx)*2u;return vec2f(uvs[i],uvs[i+1u]);}
fn wrapCoord(t:f32,repeat:bool)->f32{return select(clamp(t,0.0,1.0),fract(t),repeat);}
fn maskKeep(page:PageInfo,uv:vec2f)->bool{
 if((page.flags&128u)==0u||(page.flags&8u)==0u){return true;}
 let raw=vec2f(wrapCoord(uv.x,(page.flags&32u)!=0u),wrapCoord(uv.y,(page.flags&64u)!=0u));
 // Chaque niveau progressif préserve la couverture du seuil, donc la découpe est juste dès le
 // premier niveau reçu ; une couche prête relit le niveau 0, exactement comme avant ce lot.
 return colorAlpha(page.mapIndex,page.uvScale,raw)>=page.baseColor.w;
}`;
