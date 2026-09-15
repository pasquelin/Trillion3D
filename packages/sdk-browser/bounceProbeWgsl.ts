import { BOUNCE_SETTINGS } from '../sdk-core/index.ts';
import { BOUNCE_GRID_WGSL } from './bounceGridWgsl.ts';
import { BOUNCE_TRACE_WGSL } from './bounceTraceWgsl.ts';

/** Fils d'un groupe de travail de la passe de sondes : un groupe par sonde, un fil par rayon. */
const BOUNCE_WORKGROUP = 64;
/** Étiquette de la passe mesurée ; l'étape « Rebond » est lue sous ce nom, pas par son rang. */
export const BOUNCE_PROBE_PASS = 'WG bounce probes v1';

/**
 * La mise à jour des sondes d'irradiance des cascades.
 *
 * Une sonde lance un budget fixe de rayons contre le proxy résident et lit, à la maille touchée, la
 * radiance que le cache de surfaces y tient déjà — direct, ombres et rebond du tour précédent. Elle
 * accumule le tout en harmoniques sphériques d'**ordre 2**, neuf coefficients : un terme constant,
 * trois linéaires et cinq quadratiques, qui rendent un champ d'irradiance bien plus net qu'une base
 * d'ordre 1 sur la même dépense de rayons.
 *
 * Les sondes mises à jour sont celles d'un lot réparti entre les niveaux : le plus fin entoure la
 * caméra et reçoit la plus grosse part. Une sonde dont la maille a changé — la cascade a glissé —
 * repart de zéro ; une sonde qui garde sa maille garde son travail. Une sonde enterrée dans une
 * surface ou perdue en plein ciel s'endort : les mises à jour suivantes la sautent sans lancer un
 * rayon, jusqu'à ce qu'une lampe change ou qu'elle change de maille. C'est là le placement demandé —
 * mesuré par la sonde elle-même, jamais deviné par une règle sur la scène.
 *
 * L'amortissement est adaptatif : une sonde dont l'estimation saute converge vite, une sonde stable
 * bouge à peine. Rien n'alloue, rien ne boucle sans borne, et une scène sans lampe déclarée écrit
 * exactement zéro (P6). La grille est lue sur une copie figée avant la passe et écrite ailleurs :
 * une mise à jour ne voit jamais une voisine à demi écrite, et l'image à l'état stable ne dépend pas
 * de l'ordre dans lequel la carte a ordonnancé ses fils.
 */
export const BOUNCE_PROBE_SHADER = `
@group(0) @binding(0) var<uniform> bounce:BounceGrid;
@group(0) @binding(1) var<storage,read> proxyTriangles:array<f32>;
@group(0) @binding(2) var<storage,read> proxyAlbedo:array<u32>;
@group(0) @binding(3) var<storage,read> proxyNodeBounds:array<f32>;
@group(0) @binding(4) var<storage,read> proxyNodeChildren:array<u32>;
@group(0) @binding(5) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(6) var<storage,read> probes:array<vec4f>;
@group(0) @binding(7) var<storage,read_write> probesOut:array<vec4f>;
@group(0) @binding(8) var<storage,read> surface:array<vec4f>;
${BOUNCE_GRID_WGSL}
${BOUNCE_TRACE_WGSL}
const RAYS_PER_PROBE:u32=${BOUNCE_SETTINGS.raysPerProbe}u;
const WORKGROUP:u32=${BOUNCE_WORKGROUP}u;
const BLEND_STABLE:f32=${BOUNCE_SETTINGS.blendStable};
const BLEND_MOVING:f32=${BOUNCE_SETTINGS.blendMoving};
const MOVING_RESIDUAL:f32=${BOUNCE_SETTINGS.movingResidual};
const BOUNCE_BURIED:f32=${BOUNCE_SETTINGS.buriedFraction};
const BOUNCE_SKY:f32=${BOUNCE_SETTINGS.skyFraction};
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
 * La radiance qu'un rayon rapporte : rien s'il ne touche rien, la maille touchée sinon. C'est une
 * lecture, plus un calcul : le cache de surfaces porte déjà la radiance sortante de cette face.
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
/** Les sommes partielles d'un groupe : neuf accumulateurs de base, quatre de distance, un de trajet. */
var<workgroup> partial:array<array<vec3f,${BOUNCE_WORKGROUP}>,13>;
var<workgroup> partialTravelled:array<f32,${BOUNCE_WORKGROUP}>;
@compute @workgroup_size(${BOUNCE_WORKGROUP})
fn updateProbes(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 if(group.x>=bounce.frame.y||bounce.counts.w==0u){return;}
 // La file dit, rang par rang, quelle sonde de quel niveau travaille : l'ordonnanceur l'a remplie
 // en sautant les mailles que la carte d'occupation déclare sans intérêt.
 let packed=probeQueue[group.x];
 let picked=vec2u(packed/max(bounce.counts.z,1u),packed%max(bounce.counts.z,1u));
 if(picked.x>=bounce.counts.y){return;}
 let level=picked.x;
 let side=i32(bounce.counts.x);
 let base=vec3i(bounce.levels[level].base.xyz);
 let ranked=vec3i(vec3u(picked.y%bounce.counts.x,(picked.y/bounce.counts.x)%bounce.counts.x,picked.y/(bounce.counts.x*bounce.counts.x)));
 // La maille que ce rang porte dans ce niveau : l'inverse du rangement torique, dans [base,base+côté).
 let cell=base+(((ranked-base)%side)+side)%side;
 let slot=probeSlot(level,cell);
 let held=all(probeCell(slot)==cell);
 // Une sonde endormie — enterrée dans une surface ou perdue en plein ciel — ne relance aucun rayon
 // tant que sa maille ne change pas et qu'aucune lampe n'a bougé.
 if(held&&probes[slot+PROBE_IDLE].w==f32(bounce.frame.x)){return;}
 let spacing=bounce.levels[level].originSpacing.w;
 let origin=probeCentre(cell,spacing);
 let reach=bounce.reach.x;
 let rotation=hashUnit(picked.y*9781u+bounce.frame.z)*6.2831853;
 let jitter=hashUnit(picked.y*6151u+bounce.frame.z*131u);
 var sums:array<vec3f,13>;
 var travelled=0.0;
 // Un fil par rayon : une sonde à soixante-quatre rayons occupe un groupe entier, là où un fil
 // seul les enchaînait l'un après l'autre et laissait la carte inoccupée.
 for(var ray=lane;ray<RAYS_PER_PROBE;ray+=WORKGROUP){
  let d=rayDirection(ray,jitter,rotation);
  let sample=rayRadiance(origin,d,reach);
  let span=sample.w;
  travelled+=span;
  sums[0]+=sample.rgb*0.2820948;
  sums[1]+=sample.rgb*0.4886025*d.x;
  sums[2]+=sample.rgb*0.4886025*d.y;
  sums[3]+=sample.rgb*0.4886025*d.z;
  sums[4]+=sample.rgb*1.0925484*d.x*d.y;
  sums[5]+=sample.rgb*1.0925484*d.y*d.z;
  sums[6]+=sample.rgb*0.3153916*(3.0*d.z*d.z-1.0);
  sums[7]+=sample.rgb*1.0925484*d.x*d.z;
  sums[8]+=sample.rgb*0.5462742*(d.x*d.x-d.y*d.y);
  let weight=abs(d);
  let positive=select(vec3f(0.0),weight,d>vec3f(0.0));
  sums[9]+=positive*span;
  sums[10]+=positive;
  sums[11]+=(weight-positive)*span;
  sums[12]+=weight-positive;
 }
 // Les sommes des fils du groupe se rassemblent par moitiés successives : une seule barrière par
 // tour, et le fil zéro écrit la sonde.
 for(var k=0u;k<13u;k++){partial[k][lane]=sums[k];}
 partialTravelled[lane]=travelled;
 for(var stride=WORKGROUP/2u;stride>0u;stride>>=1u){
  workgroupBarrier();
  if(lane<stride){
   for(var k=0u;k<13u;k++){partial[k][lane]+=partial[k][lane+stride];}
   partialTravelled[lane]+=partialTravelled[lane+stride];
  }
 }
 workgroupBarrier();
 if(lane!=0u){return;}
 for(var k=0u;k<13u;k++){sums[k]=partial[k][0];}
 travelled=partialTravelled[0]/f32(RAYS_PER_PROBE);
 // Une sonde enfermée dans une surface touche quelque chose dans toutes les directions, à bout
 // portant ; une sonde en plein ciel ne touche rien. Le critère est une distance, jamais un sens
 // d'enroulement : celui-ci n'est fiable sur aucune scène importée, et le proxy est double face.
 let buried=travelled<spacing*BOUNCE_BURIED;
 let asleep=buried||travelled>reach*BOUNCE_SKY;
 let usable=select(1.0,0.0,buried);
 // Estimateur de Monte-Carlo sur la sphère entière : 4π divisé par le nombre de rayons.
 let scale=12.5663706/f32(RAYS_PER_PROBE);
 let updates=select(0.0,probes[slot].w,held);
 let previous=select(vec3f(0.0),probes[slot].xyz,held);
 let fresh=sums[0]*scale;
 let change=length(fresh-previous)/(length(fresh)+length(previous)+1e-4);
 // Hystérésis adaptative. Une sonde neuve, ou qui vient de changer de maille, prend tout ; une
 // sonde stable suit une moyenne courante, qui lisse le bruit de Monte-Carlo sans figer l'image ;
 // une sonde dont l'estimation saute reprend presque tout et repart d'un compte bas.
 var blend=max(1.0/(updates+1.0),BLEND_STABLE);
 var count=updates+1.0;
 if(change>MOVING_RESIDUAL){blend=BLEND_MOVING;count=1.0;}
 if(updates<0.5){blend=1.0;count=1.0;}
 for(var k=0u;k<9u;k++){
  let kept=select(vec3f(0.0),probes[slot+k].xyz,held);
  probesOut[slot+k]=vec4f(mix(kept,sums[k]*scale*usable,blend),0.0);
 }
 probesOut[slot].w=count;
 probesOut[slot+PROBE_CHANGE].w=change;
 probesOut[slot+PROBE_VALID].w=usable;
 probesOut[slot+PROBE_CELL].w=f32(cell.x);
 probesOut[slot+4u].w=f32(cell.y);
 probesOut[slot+5u].w=f32(cell.z);
 probesOut[slot+PROBE_IDLE].w=select(0.0,f32(bounce.frame.x),asleep);
 let meanPositive=sums[9]/max(sums[10],vec3f(1e-6));
 let meanNegative=sums[11]/max(sums[12],vec3f(1e-6));
 let keptPositive=select(vec3f(0.0),probes[slot+PROBE_DISTANCE_POSITIVE].xyz,held);
 let keptNegative=select(vec3f(0.0),probes[slot+PROBE_DISTANCE_NEGATIVE].xyz,held);
 probesOut[slot+PROBE_DISTANCE_POSITIVE]=vec4f(mix(keptPositive,meanPositive,blend),0.0);
 probesOut[slot+PROBE_DISTANCE_NEGATIVE]=vec4f(mix(keptNegative,meanNegative,blend),0.0);
}`;
