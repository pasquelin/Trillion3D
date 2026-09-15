import { BOUNCE_SETTINGS } from '../sdk-core/index.ts';
import { BOUNCE_GRID_WGSL } from './bounceGridWgsl.ts';
import { BOUNCE_TRACE_WGSL } from './bounceTraceWgsl.ts';

/** Fils d'un groupe de travail de la passe de sondes : une sonde par fil. */
export const BOUNCE_WORKGROUP = 64;
/** Étiquette de la passe mesurée ; l'étape « Rebond » est lue sous ce nom, pas par son rang. */
export const BOUNCE_PROBE_PASS = 'WG bounce probes v1';

/**
 * La mise à jour des sondes d'irradiance.
 *
 * Une sonde lance un budget fixe de rayons contre le proxy résident et lit, à la maille touchée,
 * la radiance que le cache de surfaces y tient déjà — direct, ombres et rebond du tour précédent.
 * Elle accumule le tout en harmoniques sphériques d'ordre 1. Un rayon, une traversée : les rayons
 * d'ombre et la relecture des lampes ont quitté cette passe pour celle du cache.
 *
 * Les sondes mises à jour sont celles d'une liste compacte, arrêtée à la construction : les mailles
 * qui touchent de la géométrie et la couronne autour d'elles. Une maille absente de la liste n'est
 * jamais écrite, donc elle se déclare inutilisable et ne pèse rien dans l'interpolation.
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
@group(0) @binding(4) var<storage,read> proxyNodeChildren:array<u32>;
@group(0) @binding(5) var<storage,read> probeCells:array<u32>;
@group(0) @binding(6) var<storage,read> probes:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> probesOut:array<vec4f>;
@group(0) @binding(8) var<storage,read> surface:array<vec4f>;
${BOUNCE_GRID_WGSL}
${BOUNCE_TRACE_WGSL}
const RAYS_PER_PROBE:u32=${BOUNCE_SETTINGS.raysPerProbe}u;
const BLEND_STABLE:f32=${BOUNCE_SETTINGS.blendStable};
const BLEND_MOVING:f32=${BOUNCE_SETTINGS.blendMoving};
const MOVING_RESIDUAL:f32=${BOUNCE_SETTINGS.movingResidual};
const BOUNCE_BURIED:f32=${BOUNCE_SETTINGS.buriedFraction};
const GOLDEN_ANGLE:f32=2.39996323;
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
 * La radiance qu'un rayon rapporte : rien s'il ne touche rien, la maille touchée sinon.
 *
 * C'est une lecture, plus un calcul. Le cache de surfaces porte déjà la radiance sortante de cette
 * face — direct, ombres comprises, et l'indirect que la grille avait convergé au tour précédent —
 * et il l'a payée une fois pour toutes les fois où un rayon la touche.
 */
fn rayRadiance(origin:vec3f,direction:vec3f,reach:f32)->vec4f{
 let hit=traceProxy(origin,direction,reach);
 if(!hit.found){return vec4f(0.0,0.0,0.0,reach);}
 // La face qui compte est celle qui regarde le rayon : le proxy est double face par construction.
 let face=select(0u,1u,dot(proxyNormal(hit.triangle),direction)>0.0);
 let texel=hit.triangle*2u+face;
 if(texel>=arrayLength(&surface)){return vec4f(0.0,0.0,0.0,hit.distance);}
 return vec4f(surface[texel].rgb,hit.distance);
}
@compute @workgroup_size(${BOUNCE_WORKGROUP})
fn updateProbes(@builtin(global_invocation_id) id:vec3u){
 let useful=bounce.frame.w;
 if(id.x>=bounce.frame.y||bounce.counts.w==0u||useful==0u){return;}
 // Le curseur parcourt la liste des mailles qui méritent une sonde, jamais la grille entière : le
 // ciel vide et le cœur des murs n'y sont pas, et le budget de rayons va à ce qui sera relu.
 let probe=probeCells[(bounce.frame.x+id.x)%useful];
 if(probe>=bounce.counts.w){return;}
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
