import { BOUNCE_SETTINGS, PROBE_FLOATS } from '../sdk-core/index.ts';

/**
 * Les cascades de sondes, telles que la passe de mise à jour et la résolution différée les lisent
 * toutes les deux. Une seule déclaration : les deux nuanceurs nomment `bounce` et `probes`, si bien
 * que la même interpolation sert à appliquer l'irradiance sur un pixel et à la relire au point qu'un
 * rayon a touché — c'est ce second usage qui donne les rebonds d'ordre supérieur.
 *
 * Chaque niveau est un cube de sondes posé sur un réseau global : une sonde vit au centre de sa
 * maille, aux points `(maille + ½) · écartement`, et ne bouge donc jamais. Un niveau qui suit la
 * caméra ne fait que changer les mailles qu'il tient ; une maille se range par son reste modulo le
 * côté du cube, si bien que glisser d'une maille ne périme que la tranche qui entre. Une sonde dit
 * elle-même quelle maille elle porte : si ce n'est pas celle qu'on lui demande, elle ne sait rien du
 * point et ne pèse rien. Le dernier niveau est fixe dans le monde et couvre l'emprise du proxy.
 */
export const BOUNCE_GRID_WGSL = `
struct BounceLevel{originSpacing:vec4f,base:vec4f,}
struct BounceGrid{
 reach:vec4f,
 counts:vec4u,
 frame:vec4u,
 levels:array<BounceLevel,${BOUNCE_SETTINGS.cascadeLevels}>,
}
const PROBE_VECTORS:u32=${PROBE_FLOATS / 4}u;
const CASCADE_LEVELS:u32=${BOUNCE_SETTINGS.cascadeLevels}u;
/** Les « w » qui portent l'état d'une sonde, rang par rang. */
const PROBE_CHANGE:u32=1u;
const PROBE_VALID:u32=2u;
/** La maille tenue occupe trois rangs consécutifs à partir de celui-ci : x, puis y, puis z. */
const PROBE_CELL:u32=3u;
const PROBE_IDLE:u32=6u;
const PROBE_DISTANCE_POSITIVE:u32=9u;
const PROBE_DISTANCE_NEGATIVE:u32=10u;
const BOUNCE_VISIBILITY:f32=${BOUNCE_SETTINGS.visibilityMargin};
const BOUNCE_NORMAL_BIAS:f32=${BOUNCE_SETTINGS.normalBias};
/** Le reste positif d'une maille modulo le côté du cube : c'est le rangement torique du niveau. */
fn probeWrap(cell:vec3i)->vec3u{
 let side=i32(bounce.counts.x);
 return vec3u(((cell%side)+side)%side);
}
/** Le rang d'une sonde dans le tampon : son niveau, puis sa maille rangée toriquement. */
fn probeSlot(level:u32,cell:vec3i)->u32{
 let wrapped=probeWrap(cell);
 let side=bounce.counts.x;
 return (level*bounce.counts.z+wrapped.x+side*(wrapped.y+side*wrapped.z))*PROBE_VECTORS;
}
/** Position monde d'une maille : le réseau global, indépendant de la caméra comme du niveau. */
fn probeCentre(cell:vec3i,spacing:f32)->vec3f{return (vec3f(cell)+vec3f(0.5))*spacing;}
/** La maille que la sonde dit porter. Différente de celle qu'on cherche : elle ne sait rien d'ici. */
fn probeCell(slot:u32)->vec3i{
 return vec3i(i32(probes[slot+PROBE_CELL].w),i32(probes[slot+PROBE_CELL+1u].w),i32(probes[slot+PROBE_CELL+2u].w));
}
/**
 * L'irradiance d'une base d'harmoniques sphériques d'ordre 2, convoluée par le lobe cosinus :
 * π·Y₀₀ pour le terme constant, (2π/3)·Y₁ₘ pour les trois linéaires, (π/4)·Y₂ₘ pour les cinq
 * quadratiques. Jamais négative — une base tronquée peut descendre sous zéro là où la vraie
 * irradiance ne le peut pas.
 */
fn shIrradiance(slot:u32,n:vec3f)->vec3f{
 var total=probes[slot].xyz*0.8862269;
 total+=(probes[slot+1u].xyz*n.x+probes[slot+2u].xyz*n.y+probes[slot+3u].xyz*n.z)*1.0233267;
 total+=(probes[slot+4u].xyz*(n.x*n.y)+probes[slot+5u].xyz*(n.y*n.z)+probes[slot+7u].xyz*(n.x*n.z))*0.8580854;
 total+=probes[slot+6u].xyz*(3.0*n.z*n.z-1.0)*0.2477078;
 total+=probes[slot+8u].xyz*(n.x*n.x-n.y*n.y)*0.4290427;
 return max(vec3f(0.0),total);
}
/**
 * La distance moyenne que la sonde a mesurée dans une direction, interpolée entre ses six axes.
 * C'est le test de visibilité : un point plus loin de la sonde que cette distance est derrière une
 * surface que la sonde voit, donc dans une autre pièce, et la sonde n'a rien à lui dire.
 */
fn probeDistance(slot:u32,direction:vec3f)->f32{
 let positive=probes[slot+PROBE_DISTANCE_POSITIVE].xyz;
 let negative=probes[slot+PROBE_DISTANCE_NEGATIVE].xyz;
 let weight=abs(direction);
 let picked=select(negative,positive,direction>vec3f(0.0));
 return dot(picked,weight)/max(weight.x+weight.y+weight.z,1e-6);
}
/**
 * L'irradiance d'un niveau en un point, ou rien quand ce niveau ne l'atteint pas. Huit sondes,
 * trois pondérations : la trilinéaire de la maille, le dos de la surface — une sonde derrière elle
 * n'en sait rien — et la visibilité mesurée, qui referme les fuites à travers les murs. Une sonde
 * qui ne porte pas la maille demandée, jamais mise à jour ou enterrée dans une surface, ne pèse rien.
 */
fn sampleLevel(level:u32,P:vec3f,N:vec3f)->vec4f{
 let spacing=bounce.levels[level].originSpacing.w;
 let base=vec3i(bounce.levels[level].base.xyz);
 let side=i32(bounce.counts.x);
 let biased=P+N*BOUNCE_NORMAL_BIAS*spacing;
 let local=biased/spacing-vec3f(0.5);
 let corner=vec3i(floor(local));
 // Le niveau ne répond que s'il tient les huit coins : une réponse partielle ferait une couture.
 if(any(corner<base)||any(corner+vec3i(1)>=base+vec3i(side))){return vec4f(0.0);}
 let fraction=clamp(local-floor(local),vec3f(0.0),vec3f(1.0));
 let margin=BOUNCE_VISIBILITY*spacing;
 var sum=vec3f(0.0);
 var total=0.0;
 for(var index=0u;index<8u;index++){
  let offset=vec3u(index&1u,(index>>1u)&1u,(index>>2u)&1u);
  let cell=corner+vec3i(offset);
  let slot=probeSlot(level,cell);
  if(any(probeCell(slot)!=cell)){continue;}
  if(probes[slot+PROBE_VALID].w<0.5){continue;}
  let toProbe=probeCentre(cell,spacing)-biased;
  let distance=length(toProbe);
  let direction=toProbe/max(distance,1e-6);
  let trilinear=mix(vec3f(1.0)-fraction,fraction,vec3f(offset));
  var weight=trilinear.x*trilinear.y*trilinear.z;
  let facing=dot(direction,N)*0.5+0.5;
  weight*=facing*facing;
  if(distance>probeDistance(slot,-direction)+margin){weight=0.0;}
  if(weight<=0.0){continue;}
  sum+=shIrradiance(slot,N)*weight;
  total+=weight;
 }
 return vec4f(sum,total);
}
/**
 * L'irradiance des cascades en un point : le niveau le plus fin qui sait répondre, du plus serré au
 * plus large. Quand aucun niveau ne sait, le résultat est exactement zéro — une fuite serait de la
 * lumière sans source.
 */
fn sampleBounce(P:vec3f,N:vec3f)->vec3f{
 if(bounce.counts.w==0u){return vec3f(0.0);}
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let gathered=sampleLevel(level,P,N);
  if(gathered.w>1e-5){return gathered.xyz/gathered.w;}
 }
 return vec3f(0.0);
}`;
