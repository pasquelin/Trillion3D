import { BOUNCE_SETTINGS } from '../sdk-core/index.ts';
import { DIRECT_LIGHT_WGSL } from './directLightWgsl.ts';
import { BOUNCE_GRID_WGSL } from './bounceGridWgsl.ts';
import { BOUNCE_TRACE_WGSL } from './bounceTraceWgsl.ts';

/** Fils d'un groupe de travail de la passe de cache : une maille par fil. */
export const SURFACE_WORKGROUP = 64;
/** Étiquette de la passe mesurée ; elle rejoint l'étape « Rebond » comme celle des sondes. */
export const BOUNCE_SURFACE_PASS = 'WG bounce surface cache v1';

/**
 * Le cache de surfaces du proxy (LR5) : une radiance sortante par triangle et par face.
 *
 * Sans lui, chaque rayon de sonde qui touche une surface y rejouait toutes les lampes et tous leurs
 * rayons d'ombre : cinq traversées du proxy par rayon au lieu d'une, et le même point réévalué
 * autant de fois que des rayons le touchaient. Le cache paie ce travail une fois par maille, sur un
 * budget fixe par image, et le rayon n'a plus qu'une lecture à faire. Le rebond multiple devient
 * gratuit : la maille porte déjà l'indirect du tour précédent, relu dans la grille de sondes.
 *
 * La maille est le triangle du proxy lui-même, dont le compilateur borne la taille : c'est ce qui
 * donne au cache une résolution connue en mètres, sans atlas ni projection. Les deux faces sont
 * tenues séparément — un mur n'est pas éclairé pareil des deux côtés, et le proxy est double face.
 *
 * Rien n'est cuit : le cache est reconstruit par balayage dès qu'une lampe change, comme une carte
 * d'ombre est redessinée. Une scène immobile n'en met aucune maille à jour.
 */
export const BOUNCE_SURFACE_SHADER = `
struct SurfaceSpan{span:vec4u,}
@group(0) @binding(0) var<uniform> bounce:BounceGrid;
@group(0) @binding(1) var<storage,read> proxyTriangles:array<f32>;
@group(0) @binding(2) var<storage,read> proxyAlbedo:array<u32>;
@group(0) @binding(3) var<storage,read> proxyNodeBounds:array<f32>;
@group(0) @binding(4) var<storage,read> proxyNodeChildren:array<u32>;
@group(0) @binding(5) var<storage,read> directLights:DirectLights;
@group(0) @binding(6) var<storage,read> probes:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> surface:array<vec4f>;
@group(0) @binding(8) var<uniform> cursor:SurfaceSpan;
${DIRECT_LIGHT_WGSL}
${BOUNCE_GRID_WGSL}
${BOUNCE_TRACE_WGSL}
const LIGHTS_PER_TEXEL:u32=${BOUNCE_SETTINGS.lightsPerRay}u;
const SURFACE_INVERSE_PI:f32=0.31830989;
/**
 * L'irradiance des lampes déclarées en un point de maille. Les ombres sont tracées contre le proxy,
 * ce qui garde une porte fermée fermée pour le rebond comme pour le direct ; le nombre de rayons
 * d'ombre est plafonné, et ce qu'il écarte l'est dans l'ordre des lampes, donc de façon déterminée.
 */
fn directIrradiance(P:vec3f,N:vec3f,reach:f32)->vec3f{
 var total=vec3f(0.0);
 var shadows=0u;
 let count=min(directLights.count,MAX_LIGHTS);
 let offset=P+N*1e-3;
 for(var index=0u;index<MAX_LIGHTS;index++){
  if(index>=count){break;}
  let light=directLights.items[index];
  let incidence=directIncidence(light,P);
  if(incidence.w<=0.0){continue;}
  let cosine=dot(N,incidence.xyz);
  if(cosine<=0.0){continue;}
  if(light.params.z>0.5&&shadows<LIGHTS_PER_TEXEL){
   shadows++;
   let span=select(length(light.positionRange.xyz-P),reach,light.params.x>KIND_SUN-0.5);
   if(proxyBlocked(offset,incidence.xyz,span)){continue;}
  }
  total+=light.colorIntensity.rgb*light.colorIntensity.w*incidence.w*cosine;
 }
 return total;
}
@compute @workgroup_size(${SURFACE_WORKGROUP})
fn updateSurface(@builtin(global_invocation_id) id:vec3u){
 let total=arrayLength(&surface);
 if(id.x>=cursor.span.y||total==0u){return;}
 let texel=(cursor.span.x+id.x)%total;
 let triangle=texel>>1u;
 // Face zéro : le côté de la normale géométrique. Face un : l'autre. Le sens d'enroulement de la
 // source n'entre jamais en jeu — il n'est fiable sur aucune scène importée.
 let normal=select(proxyNormal(triangle),-proxyNormal(triangle),(texel&1u)==1u);
 let point=proxyCentre(triangle);
 let reach=bounce.origin.w;
 // Direct exact de l'image, plus l'indirect que la grille a déjà convergé : c'est ce terme-là qui
 // ferme la série des rebonds, un ordre de plus à chaque balayage.
 let irradiance=directIrradiance(point,normal,reach)+sampleBounce(point,normal);
 surface[texel]=vec4f(proxyAlbedoOf(triangle)*irradiance*SURFACE_INVERSE_PI,1.0);
}`;
