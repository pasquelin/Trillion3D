import { WRAP_MAP } from './visibilityWrapModes.ts';
import { VIS_BINDINGS } from './webgpuBindLayout.ts';

/**
 * La géométrie d'une page telle que le GPU la lit : la description d'un cluster, l'uniforme de son
 * slot de dessin, et la résolution du rang de page d'une instance indirecte. Une seule déclaration,
 * partagée par le raster du visibility buffer et par les passes de profondeur des ombres — deux
 * copies de cette structure seraient deux chances de la voir dériver.
 */
/** Les six `pad*Uv` sont les échelles uv d'atlas que les textures virtuelles ont rendues inutiles :
 *  une texture est lue dans son propre espace. Ils restent à zéro, jamais lus, jusqu'au recompactage
 *  de la fiche (backlog Textures). */
export const PAGE_INFO_STRUCT_WGSL = `struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,padBaseUv:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,padRoughUv:vec2f,padMetalUv:vec2f,padNormalUv:vec2f,aoIndex:u32,aoIntensity:f32,padAoUv:vec2f,emissiveIndex:u32,selectionIndex:u32,emissive:vec4f,padEmissiveUv:vec2f,normalScaleY:f32,pad1:f32,pad4:vec4f,depthBias:u32,wrapModes:u32,placement:u32,pad5d:u32,}`;

/** L'uniforme d'une image du tampon de visibilité, le même mot à mot pour les deux rasters et les
 *  résolutions : `webgpuVisibilityUniforms.ts` l'écrit une fois par slot. */
export const VIS_UNIFORMS_WGSL = `struct Uniforms{viewProj:mat4x4f,viewport:vec2f,computeSpan:f32,pageCount:u32,drawSlot:u32,indirect:u32,selectionOffset:u32,selectionEnabled:u32,maskFrame:f32,padMask0:f32,padMask1:f32,padMask2:f32,}`;

/** La description d'un cluster, suivie de l'uniforme d'une passe de géométrie de page. */
export const PAGE_INFO_WGSL = `${PAGE_INFO_STRUCT_WGSL}
${VIS_UNIFORMS_WGSL}`;

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

/** Aire signée du triangle `(a,b,p)` en coordonnées écran ; le raster en tire ses barycentriques. */
export const EDGE_WGSL = `fn edge(a:vec2f,b:vec2f,p:vec2f)->f32{return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}`;

/**
 * Les trois poids barycentriques affines du point `p`, l'aire signée étant déjà connue, pour
 * l'ombrage du tampon de visibilité. Le raster de calcul a les siens : il décide la couverture sur
 * ses trois arêtes, et un poids dérivé par `1-w0-w1` n'est pas étanche. Exige `EDGE_WGSL`.
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
 * `ddx`, `ddy` sont les dérivées de la coordonnée par texel de la passe qui lit — pixel de la caméra
 * ou texel d'ombre — : chacune lit la carte au niveau de son empreinte, comme la passe matériaux
 * lit sa couleur (`maskAlpha`, `webgpuTileWgsl.ts`). Le raster de calcul, qui n'a pas de dérivées,
 * passe zéro et lit le niveau 0 — la tuile la plus fine résidente sous ce texel.
 *
 * Le shader hôte déclare `uvs`, le pool couleur et sa table de pages, puis insère `TILE_POOL_WGSL`
 * (qui porte la règle d'adressage), `COLOR_SAMPLE_WGSL` et `maskAlphaWgsl(...)` avant ce bloc.
 */
export const MASK_KEEP_WGSL = `fn maskHash(pixel:vec2f,frame:f32)->f32{
 let p=floor(pixel)+vec2f(5.588238*frame,0.0);
 return fract(52.9829189*fract(dot(p,vec2f(0.06711056,0.00583715))));
}
fn maskKeep(page:PageInfo,uv:vec2f,ddx:vec2f,ddy:vec2f,pixel:vec2f,frame:f32)->bool{
 if((page.flags&128u)==0u||(page.flags&8u)==0u){return true;}
 // Les niveaux de la chaîne prennent la MÉDIANE de l'alpha, jamais sa moyenne : un texel grossier
 // passe le seuil quand la moitié de ce qu'il recouvre le passait, donc la couverture du seuil
 // traverse les niveaux et la découpe reste juste à tout niveau. Une moyenne, elle, faisait grossir
 // la silhouette niveau après niveau et rendait le quad opaque pendant le chargement.
 // Hashed Alpha Testing (Wyman, McGuire, I3D 2017) with interleaved gradient noise (Jimenez):
 // keep/discard is a function of the SCREEN pixel and the TAA sample, not of a GPU coin-flip
 // at the cutoff. Same pixel, same frame → same bit in every run (#25). A few ALU, no extra pass.
 let a=maskAlpha(page.mapIndex,uv,wrapOf(page.wrapModes,${WRAP_MAP.base}u),ddx,ddy);
 let t=page.baseColor.w;
 let coverage=clamp((a-t)/max(1.0-t,1e-5),0.0,1.0);
 return coverage>maskHash(pixel,frame);
}`;

/** Le test de masque précédé de la coordonnée de texture qu'un sommet de page lui fournit. */
export const PAGE_MASK_WGSL = `${PAGE_UV_WGSL}
${MASK_KEEP_WGSL}`;
