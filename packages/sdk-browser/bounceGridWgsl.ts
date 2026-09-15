import { BOUNCE_SETTINGS, PROBE_FLOATS } from '../sdk-core/index.ts';

/**
 * La grille de sondes, telle que la passe de mise à jour et la résolution différée la lisent toutes
 * les deux. Une seule déclaration : les deux nuanceurs nomment `bounce` et `probes`, si bien que la
 * même interpolation sert à appliquer l'irradiance sur un pixel et à la relire au point qu'un rayon
 * a touché — c'est ce second usage qui donne le rebond d'ordre deux.
 *
 * La grille est fixe dans le monde, posée sur l'emprise du proxy : rien ici ne dépend de la caméra.
 */
export const BOUNCE_GRID_WGSL = `
struct BounceGrid{origin:vec4f,spacing:vec4f,counts:vec4u,frame:vec4u,}
const PROBE_VECTORS:u32=${PROBE_FLOATS / 4}u;
const PROBE_VALID:u32=2u;
const PROBE_DISTANCE_POSITIVE:u32=4u;
const PROBE_DISTANCE_NEGATIVE:u32=5u;
const BOUNCE_VISIBILITY:f32=${BOUNCE_SETTINGS.visibilityMargin};
const BOUNCE_NORMAL_BIAS:f32=${BOUNCE_SETTINGS.normalBias};
/** Le plus grand pas de la grille : c'est lui qui donne l'échelle des marges en mètres. */
fn probeStep()->f32{
 return max(bounce.spacing.x,max(bounce.spacing.y,bounce.spacing.z));
}
/** Position monde d'une sonde. La grille est fixe : une sonde ne bouge jamais d'une image à l'autre. */
fn probePosition(probe:u32)->vec3f{
 let nx=max(bounce.counts.x,1u);
 let ny=max(bounce.counts.y,1u);
 let cell=vec3u(probe%nx,(probe/nx)%ny,probe/(nx*ny));
 return bounce.origin.xyz+bounce.spacing.xyz*vec3f(cell);
}
fn probeIndex(cell:vec3u)->u32{
 return cell.x+bounce.counts.x*(cell.y+bounce.counts.y*cell.z);
}
/**
 * L'irradiance d'une base d'harmoniques sphériques d'ordre 1, convoluée par le lobe cosinus :
 * π·Y₀₀ pour le terme constant, (2π/3)·Y₁ₘ pour les trois termes directionnels. Jamais négative —
 * une base d'ordre 1 peut descendre sous zéro là où la vraie irradiance ne le peut pas.
 */
fn shIrradiance(c0:vec3f,cx:vec3f,cy:vec3f,cz:vec3f,n:vec3f)->vec3f{
 return max(vec3f(0.0),c0*0.8862269+(cx*n.x+cy*n.y+cz*n.z)*1.0233267);
}
/**
 * La distance moyenne que la sonde a mesurée dans une direction, interpolée entre ses six axes.
 * C'est le test de visibilité : un point plus loin de la sonde que cette distance est derrière une
 * surface que la sonde voit, donc dans une autre pièce, et la sonde n'a rien à lui dire.
 */
fn probeDistance(probe:u32,direction:vec3f)->f32{
 let base=probe*PROBE_VECTORS;
 let positive=probes[base+PROBE_DISTANCE_POSITIVE].xyz;
 let negative=probes[base+PROBE_DISTANCE_NEGATIVE].xyz;
 let weight=abs(direction);
 let picked=select(negative,positive,direction>vec3f(0.0));
 return dot(picked,weight)/max(weight.x+weight.y+weight.z,1e-6);
}
/**
 * L'irradiance de la grille en un point, pour une normale donnée. Huit sondes, trois pondérations :
 * la trilinéaire de la cellule, le dos de la surface — une sonde derrière elle n'en sait rien — et
 * la visibilité mesurée, qui referme les fuites à travers les murs. Quand aucune sonde ne voit le
 * point, le résultat est exactement zéro : une fuite serait de la lumière sans source.
 */
fn sampleBounce(P:vec3f,N:vec3f)->vec3f{
 if(bounce.counts.w==0u){return vec3f(0.0);}
 let step=probeStep();
 let biased=P+N*BOUNCE_NORMAL_BIAS*step;
 let local=(biased-bounce.origin.xyz)/max(bounce.spacing.xyz,vec3f(1e-6));
 let last=max(vec3f(0.0),vec3f(bounce.counts.xyz)-vec3f(2.0));
 let base=clamp(floor(local),vec3f(0.0),last);
 let fraction=clamp(local-base,vec3f(0.0),vec3f(1.0));
 let margin=BOUNCE_VISIBILITY*step;
 var sum=vec3f(0.0);
 var total=0.0;
 for(var corner=0u;corner<8u;corner++){
  let offset=vec3u(corner&1u,(corner>>1u)&1u,(corner>>2u)&1u);
  let cell=min(vec3u(base)+offset,bounce.counts.xyz-vec3u(1u));
  let probe=probeIndex(cell);
  if(probe>=bounce.counts.w){continue;}
  // Une sonde enfermée dans une surface, ou jamais encore mise à jour, ne pèse rien.
  if(probes[probe*PROBE_VECTORS+PROBE_VALID].w<0.5){continue;}
  let toProbe=probePosition(probe)-biased;
  let distance=length(toProbe);
  let direction=toProbe/max(distance,1e-6);
  let trilinear=mix(vec3f(1.0)-fraction,fraction,vec3f(offset));
  var weight=trilinear.x*trilinear.y*trilinear.z;
  let facing=dot(direction,N)*0.5+0.5;
  weight*=facing*facing;
  if(distance>probeDistance(probe,-direction)+margin){weight=0.0;}
  if(weight<=0.0){continue;}
  let slot=probe*PROBE_VECTORS;
  sum+=shIrradiance(probes[slot].xyz,probes[slot+1u].xyz,probes[slot+2u].xyz,probes[slot+3u].xyz,N)*weight;
  total+=weight;
 }
 return select(vec3f(0.0),sum/total,total>1e-5);
}`;
