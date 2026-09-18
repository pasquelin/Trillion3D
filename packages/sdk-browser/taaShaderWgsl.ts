import { FULLSCREEN_VERTEX } from './deferredLightingShaders.ts';
import { PAGE_INFO_STRUCT_WGSL } from './visibilityPageWgsl.ts';

/** Étiquette de la passe ; sa durée par horodatage absorbe celle des passes qui la précèdent sur
 *  certains appareils (apple metal-3), et ne se lit sûrement que par différence d'enveloppe. */
export const TAA_PASS = 'WG temporal antialiasing';

/** Liaisons de la passe, dans l'ordre des entrées de sa disposition. */
export const TAA_BINDINGS = {
  current: 0,
  history: 1,
  historySampler: 2,
  depth: 3,
  ids: 4,
  pages: 5,
  motion: 6,
  view: 7,
} as const;

/** Octets de l'uniforme : deux matrices, trois quadruplets, puis les neuf poids en trois. */
export const TAA_VIEW_BYTES = 208;

/**
 * L'uniforme de la passe. `prevViewProj` et `invViewProj` sont RAPPORTÉES À L'ŒIL de cette image et
 * toutes deux SANS gigue : l'inverse rend, pour le centre non décalé du pixel et la profondeur lue à
 * l'échantillon, une position relative à l'œil ; la précédente la reprend telle quelle — c'est le
 * même ancrage que la partition, pour que les coordonnées monde à cinq chiffres d'un modèle urbain
 * ne mangent pas la précision simple de la reprojection. `viewport` = (largeur, hauteur, 1/largeur,
 * 1/hauteur) ; `params` = (part de l'image courante, historique valable, un placement a bougé, 0) ;
 * `weights` = les neuf poids du filtre de l'image courante, voisin par voisin (`taaWeights.ts`).
 */
const VIEW_WGSL = `struct TaaView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,}`;

const BINDINGS_WGSL = `
@group(0) @binding(${TAA_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.history}) var history:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.historySampler}) var historySampler:sampler;
@group(0) @binding(${TAA_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${TAA_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${TAA_BINDINGS.motion}) var<storage,read> motion:array<mat4x4f>;
@group(0) @binding(${TAA_BINDINGS.view}) var<uniform> view:TaaView;`;

/** YCoCg, l'espace où la boîte des voisins se serre le mieux autour de la couleur. */
export const YCOCG_WGSL = `
fn toYcocg(c:vec3f)->vec3f{return vec3f(0.25*c.r+0.5*c.g+0.25*c.b,0.5*c.r-0.5*c.b,-0.25*c.r+0.5*c.g-0.25*c.b);}
fn fromYcocg(c:vec3f)->vec3f{return vec3f(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}`;

/**
 * Où ce pixel était à l'image précédente, en coordonnées de texture de l'historique, et si cette
 * position est lisible. Le pixel est reconstruit en homogène depuis sa profondeur — le fond, à
 * profondeur zéro (inversée, plan lointain infini), est une direction et se reprojette aussi, ce
 * qui tient la silhouette stable quand la caméra tourne. Quand un placement a bougé, un pixel de
 * géométrie passe d'abord par la matrice de mouvement du sien — `précédent·courant⁻¹`, l'identité
 * pour ceux qui n'ont pas bougé ; sinon rien n'est lu, ni identifiant, ni fiche, ni matrice.
 */
export const TAA_REPROJECT_WGSL = `
fn previousUv(coord:vec2i,depthValue:f32)->vec3f{
 let ndc=vec2f((f32(coord.x)+0.5)*view.viewport.z*2.0-1.0,1.0-(f32(coord.y)+0.5)*view.viewport.w*2.0);
 var position=view.invViewProj*vec4f(ndc,depthValue,1.0);
 if(view.params.z!=0.0){
  let id=textureLoad(ids,coord,0).r;
  if(id!=0u){position=motion[pages[(id>>8u)-1u].placement]*position;}
 }
 let previous=view.prevViewProj*position;
 if(previous.w<=0.0){return vec3f(0.0,0.0,0.0);}
 let uv=vec2f(previous.x/previous.w*0.5+0.5,0.5-previous.y/previous.w*0.5);
 let inside=all(uv>=vec2f(0.0))&&all(uv<=vec2f(1.0));
 return vec3f(uv,select(0.0,1.0,inside));
}`;

/**
 * La résolution temporelle. L'image courante est refiltrée sur ses 3×3 voisins avec les poids de
 * l'uniforme (Blackman-Harris centré sur le centre non décalé) ; l'historique est lu au point
 * reprojeté, borné à la boîte YCoCg de ces
 * mêmes voisins — ce qui retire les fantômes d'un objet qui bouge ou d'une découverte —, puis les
 * deux sont mêlés, chacun pesé par l'inverse de sa luminance pour qu'une étincelle ne s'installe
 * pas. Les quatre canaux sont accumulés : l'alpha porte la couverture que la composition divise.
 */
export const TAA_SHADER = `
${PAGE_INFO_STRUCT_WGSL}
${VIEW_WGSL}
${BINDINGS_WGSL}
${FULLSCREEN_VERTEX}
${YCOCG_WGSL}
${TAA_REPROJECT_WGSL}
@fragment fn resolve(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);
 let last=vec2i(view.viewport.xy)-vec2i(1);
 var filtered=vec4f(0.0);
 var lo=vec4f(1e9);var hi=vec4f(-1e9);
 var k=0u;
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let sample=textureLoad(current,clamp(coord+vec2i(dx,dy),vec2i(0),last),0);
  filtered+=sample*view.weights[k>>2u][k&3u];k++;
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
 }}
 if(view.params.y==0.0){return filtered;}
 let previous=previousUv(coord,textureLoad(depth,coord,0));
 if(previous.z==0.0){return filtered;}
 let read=textureSampleLevel(history,historySampler,previous.xy,0.0);
 let clamped=clamp(vec4f(toYcocg(read.rgb),read.a),lo,hi);
 let kept=vec4f(fromYcocg(clamped.xyz),clamped.w);
 let alpha=view.params.x;
 let wc=alpha/(1.0+toYcocg(filtered.rgb).x);
 let wh=(1.0-alpha)/(1.0+clamped.x);
 return (filtered*wc+kept*wh)/(wc+wh);
}`;
