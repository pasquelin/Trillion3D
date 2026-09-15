import { BOUNCE_SETTINGS } from '../sdk-core/index.ts';
import { DIRECT_LIGHT_WGSL } from './directLightWgsl.ts';
import { BOUNCE_GRID_WGSL } from './bounceGridWgsl.ts';
import { BOUNCE_TRACE_WGSL } from './bounceTraceWgsl.ts';

/** Fils d'un groupe de travail de la passe de sondes : une sonde par fil. */
export const BOUNCE_WORKGROUP = 64;
/** Étiquette de la passe mesurée ; l'étape « Rebond » est lue sous ce nom, pas par son rang. */
export const BOUNCE_PROBE_PASS = 'WG bounce probes v1';

/**
 * La mise à jour des sondes d'irradiance.
 *
 * Une sonde lance un budget fixe de rayons contre le proxy résident, évalue au point touché
 * l'éclairage des lampes déclarées — mêmes lampes, mêmes ombres logiques, mais tracées contre le
 * proxy et non contre l'atlas — y ajoute ce que la grille sait déjà de ce point, ce qui donne le
 * rebond d'ordre deux, et accumule le tout en harmoniques sphériques d'ordre 1.
 *
 * L'amortissement est adaptatif : une sonde dont l'estimation saute converge vite, une sonde stable
 * bouge à peine. Rien n'alloue, rien ne boucle sans borne, et une scène sans lampe déclarée écrit
 * exactement zéro (P6).
 *
 * La grille est lue sur une copie figée avant la passe et écrite ailleurs : une mise à jour ne voit
 * jamais une voisine à demi écrite, et l'image à l'état stable ne dépend pas de l'ordre dans lequel
 * la carte a ordonnancé ses fils. Chaque balayage ajoute un ordre de rebond à la série.
 */
export const BOUNCE_PROBE_SHADER = `
@group(0) @binding(0) var<uniform> bounce:BounceGrid;
@group(0) @binding(1) var<storage,read> proxyTriangles:array<f32>;
@group(0) @binding(2) var<storage,read> proxyAlbedo:array<u32>;
@group(0) @binding(3) var<storage,read> proxyNodeBounds:array<f32>;
@group(0) @binding(4) var<storage,read> proxyNodeLinks:array<u32>;
@group(0) @binding(5) var<storage,read> directLights:DirectLights;
@group(0) @binding(6) var<storage,read> probes:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> probesOut:array<vec4f>;
${DIRECT_LIGHT_WGSL}
${BOUNCE_GRID_WGSL}
${BOUNCE_TRACE_WGSL}
const RAYS_PER_PROBE:u32=${BOUNCE_SETTINGS.raysPerProbe}u;
const LIGHTS_PER_RAY:u32=${BOUNCE_SETTINGS.lightsPerRay}u;
const BLEND_STABLE:f32=${BOUNCE_SETTINGS.blendStable};
const BLEND_MOVING:f32=${BOUNCE_SETTINGS.blendMoving};
const MOVING_RESIDUAL:f32=${BOUNCE_SETTINGS.movingResidual};
const BOUNCE_BURIED:f32=${BOUNCE_SETTINGS.buriedFraction};
const GOLDEN_ANGLE:f32=2.39996323;
const INVERSE_PI:f32=0.31830989;
/** Un entier mélangé puis ramené dans [0,1) : la graine d'une rotation, jamais un nombre au hasard. */
fn hashUnit(seed:u32)->f32{
 var x=seed*747796405u+2891336453u;
 x=((x>>((x>>28u)+4u))^x)*277803737u;
 x=(x>>22u)^x;
 return f32(x)*2.3283064e-10;
}
/** Une direction d'une spirale de Fibonacci, décalée à chaque mise à jour pour couvrir la sphère. */
fn rayDirection(slot:u32,jitter:f32,rotation:f32)->vec3f{
 let index=f32(slot)+jitter;
 let z=1.0-2.0*index/f32(RAYS_PER_PROBE);
 let radius=sqrt(max(0.0,1.0-z*z));
 let angle=index*GOLDEN_ANGLE+rotation;
 return vec3f(radius*cos(angle),radius*sin(angle),z);
}
/**
 * L'irradiance des lampes déclarées au point touché. Les ombres sont tracées contre le proxy, ce
 * qui garde une porte fermée fermée pour le rebond comme pour le direct ; le nombre de rayons
 * d'ombre d'un point est plafonné, et ce qu'il écarte est écarté dans l'ordre des lampes, donc de
 * façon déterminée.
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
  if(light.params.z>0.5&&shadows<LIGHTS_PER_RAY){
   shadows++;
   let span=select(length(light.positionRange.xyz-P),reach,light.params.x>KIND_SUN-0.5);
   if(proxyBlocked(offset,incidence.xyz,span)){continue;}
  }
  total+=light.colorIntensity.rgb*light.colorIntensity.w*incidence.w*cosine;
 }
 return total;
}
/** La radiance qu'un rayon rapporte : rien s'il ne touche rien, la surface touchée sinon. */
fn rayRadiance(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 let hit=traceProxy(origin,direction,reach);
 if(!hit.found){return vec4f(0.0,0.0,0.0,reach);}
 let point=origin+direction*hit.distance;
 var normal=proxyNormal(hit.triangle);
 // Le proxy est double face : la normale qui compte est celle qui regarde le rayon. Le sens
 // d'enroulement de la source n'entre jamais en jeu — il n'est fiable sur aucune scène importée.
 normal=select(normal,-normal,dot(normal,direction)>0.0);
 let albedo=proxyAlbedoOf(hit.triangle);
 // Le second rebond vient de la grille elle-même, relue au point touché : la convergence de
 // l'image précédente porte l'ordre deux, et les suivants arrivent aux mises à jour suivantes.
 let irradiance=directIrradiance(point,normal,reach)+sampleBounce(point,normal);
 return vec4f(albedo*irradiance*INVERSE_PI,hit.distance);
}
@compute @workgroup_size(${BOUNCE_WORKGROUP})
fn updateProbes(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=bounce.frame.y||bounce.counts.w==0u){return;}
 let probe=(bounce.frame.x+id.x)%bounce.counts.w;
 let origin=probePosition(probe);
 let reach=bounce.origin.w;
 let rotation=hashUnit(probe*9781u+bounce.frame.z)*6.2831853;
 let jitter=hashUnit(probe*6151u+bounce.frame.z*131u);
 var constant=vec3f(0.0);
 var axisX=vec3f(0.0);
 var axisY=vec3f(0.0);
 var axisZ=vec3f(0.0);
 var spanPositive=vec3f(0.0);
 var spanNegative=vec3f(0.0);
 var weightPositive=vec3f(0.0);
 var weightNegative=vec3f(0.0);
 var travelled=0.0;
 for(var ray=0u;ray<RAYS_PER_PROBE;ray++){
  let direction=rayDirection(ray,jitter,rotation);
  let sample=rayRadiance(origin,direction,reach);
  let span=sample.w;
  travelled+=span;
  constant+=sample.rgb*0.2820948;
  axisX+=sample.rgb*0.4886025*direction.x;
  axisY+=sample.rgb*0.4886025*direction.y;
  axisZ+=sample.rgb*0.4886025*direction.z;
  let weight=abs(direction);
  let positive=select(vec3f(0.0),weight,direction>vec3f(0.0));
  let negative=weight-positive;
  spanPositive+=positive*span;
  weightPositive+=positive;
  spanNegative+=negative*span;
  weightNegative+=negative;
 }
 // Une sonde enfermée dans une surface touche quelque chose dans toutes les directions, à bout
 // portant. Elle se déclare alors inutilisable plutôt que de répandre la lumière d'un intérieur de
 // mur dans la pièce d'à côté. Le critère est une distance, jamais un sens d'enroulement : celui-ci
 // n'est fiable sur aucune scène importée, et le proxy est double face par construction.
 let cell=min(bounce.spacing.x,min(bounce.spacing.y,bounce.spacing.z));
 let usable=select(1.0,0.0,travelled/f32(RAYS_PER_PROBE)<cell*BOUNCE_BURIED);
 // Estimateur de Monte-Carlo sur la sphère entière : 4π divisé par le nombre de rayons.
 let scale=12.5663706/f32(RAYS_PER_PROBE);
 let slot=probe*PROBE_VECTORS;
 let updates=probes[slot].w;
 let previous=probes[slot].xyz;
 let fresh=constant*scale;
 let change=length(fresh-previous)/(length(fresh)+length(previous)+1e-4);
 // Hystérésis adaptative. Une sonde neuve prend tout ; une sonde stable suit une moyenne
 // courante, qui lisse le bruit de Monte-Carlo sans jamais figer l'image ; une sonde dont
 // l'estimation saute reprend presque tout et repart d'un compte bas, si bien qu'elle converge en
 // quelques balayages au lieu de traîner. C'est le même mécanisme qui tient le retard court et
 // l'image calme, sans autre réglage que les deux bornes publiées.
 var blend=max(1.0/(updates+1.0),BLEND_STABLE);
 var count=updates+1.0;
 if(change>MOVING_RESIDUAL){blend=BLEND_MOVING;count=1.0;}
 if(updates<0.5){blend=1.0;count=1.0;}
 probesOut[slot]=vec4f(mix(previous,fresh*usable,blend),count);
 probesOut[slot+1u]=vec4f(mix(probes[slot+1u].xyz,axisX*scale*usable,blend),change);
 probesOut[slot+2u]=vec4f(mix(probes[slot+2u].xyz,axisY*scale*usable,blend),usable);
 probesOut[slot+3u]=vec4f(mix(probes[slot+3u].xyz,axisZ*scale*usable,blend),0.0);
 let meanPositive=spanPositive/max(weightPositive,vec3f(1e-6));
 let meanNegative=spanNegative/max(weightNegative,vec3f(1e-6));
 probesOut[slot+4u]=vec4f(mix(probes[slot+4u].xyz,meanPositive,blend),0.0);
 probesOut[slot+5u]=vec4f(mix(probes[slot+5u].xyz,meanNegative,blend),0.0);
}`;
