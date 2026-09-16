import * as THREE from 'three';
import type { VisMaterial } from './visibilityTypes.ts';

/**
 * Le mode d'adressage d'une carte, un quartet de bits par carte, six cartes dans un seul mot, et la
 * règle qui ramène une coordonnée dans la texture. Le mot et la règle qu'il commande vivent
 * ensemble : personne n'a à ouvrir deux fichiers pour lire un adressage.
 *
 * Un matériau ne règle pas ses cartes ensemble : la couleur peut se répéter là où les normales se
 * serrent, et le miroir ne porter que sur l'occlusion. Un mode par matériau adressait donc cinq
 * cartes sur six dans le mode d'une autre — c'est ce que ce mot corrige. Les bits d'un quartet :
 * 1 = S se répète, 2 = S se répète en miroir, 4 et 8 les mêmes sur T. Les deux bits d'un axe
 * s'excluent, donc `wrapAxis` n'a jamais à arbitrer entre eux, et aucun bit ne dit « serrage » :
 * c'est le quartet nul.
 */
export const WRAP_S_REPEAT = 1,
  WRAP_S_MIRROR = 2,
  WRAP_T_REPEAT = 4,
  WRAP_T_MIRROR = 8;

/** Les deux bits de répétition : sans eux, aucune période ne reboucle, donc aucune couture. */
const WRAP_REPEATS = WRAP_S_REPEAT | WRAP_T_REPEAT;

/** Rang de chaque carte dans le mot : quatre bits chacune, vingt-quatre bits employés sur trente-deux. */
export const WRAP_MAP = {
  base: 0,
  rough: 1,
  metal: 2,
  normal: 3,
  ao: 4,
  emissive: 5,
} as const;

/**
 * La carte de `VisMaterial` que chaque rang du mot décrit. Un rang ajouté à `WRAP_MAP` sans sa
 * source ne compile pas : sinon la carte nouvelle adresserait en serrage sans que rien ne le dise.
 */
const WRAP_SOURCE = {
  base: 'map',
  rough: 'roughnessMap',
  metal: 'metalnessMap',
  normal: 'normalMap',
  ao: 'aoMap',
  emissive: 'emissiveMap',
} as const satisfies Record<keyof typeof WRAP_MAP, keyof VisMaterial>;

/** Le quartet d'une carte : aucun bit en serrage, un bit par axe sinon, jamais les deux du même axe. */
export function wrapNibble(map: THREE.Texture | undefined) {
  if (!map) return 0;
  const axis = (wrap: THREE.Wrapping, repeat: number, mirror: number) =>
    wrap === THREE.ClampToEdgeWrapping
      ? 0
      : wrap === THREE.MirroredRepeatWrapping
        ? mirror
        : repeat;
  return (
    axis(map.wrapS, WRAP_S_REPEAT, WRAP_S_MIRROR) | axis(map.wrapT, WRAP_T_REPEAT, WRAP_T_MIRROR)
  );
}

/** Les couples nom/rang de `WRAP_MAP`, lus une fois : le mot d'un matériau est écrit par ligne de
 *  page, et `Object.entries` en rendait un tableau neuf à chacune. */
const WRAP_ENTRIES = Object.entries(WRAP_MAP) as [keyof typeof WRAP_MAP, number][];

/**
 * Le mot d'adressage d'un matériau : le quartet de chacune de ses cartes à son rang. Écrit par
 * `webgpuPageRow.ts` dans la fiche de page et par `webgpuBlendPrepare.ts` dans l'uniforme d'un lot
 * transparent — une page et un lot transparent portant des mots différents adresseraient les mêmes
 * textures de deux façons. Les rangs viennent de `WRAP_MAP` même, jamais d'une seconde liste écrite
 * à la main, qui laisserait passer une carte de plus en silence.
 */
export function wrapModes(mat: VisMaterial) {
  let mot = 0;
  for (const [nom, rang] of WRAP_ENTRIES) mot |= wrapNibble(mat[WRAP_SOURCE[nom]]) << (4 * rang);
  return mot;
}

/** Miroir processeur de `wrapOf` (WGSL) : le quartet de la carte `map` dans le mot. */
export const wrapOf = (modes: number, map: number) => (modes >>> (4 * map)) & 15;

/** `wrapOf` tel que le nuanceur le lit, déclaré une fois avec la règle d'adressage qui l'emploie. */
const WRAP_OF_WGSL = `fn wrapOf(modes:u32,map:u32)->u32{return (modes>>(map*4u))&15u;}`;

/**
 * La coordonnée de texture ramenée dans [0, 1] selon le mode de chaque axe, pour un échantillonneur
 * en serrage. Le miroir lit les périodes impaires à rebours : `p` parcourt [0, 2) et `2 - p` est
 * exact, donc le filtrage linéaire rend la couleur de l'échantillonneur `mirror-repeat` de Three.
 *
 * `wrapUv` reçoit le quartet de la carte lue, pas les drapeaux du matériau : la couleur d'une page
 * peut se répéter là où ses normales se serrent.
 *
 * Replier la coordonnée suffit au plus proche et au miroir, jamais à la répétition en filtrage
 * linéaire : dans le demi-texel des deux bords d'une période, la règle de l'échantillonneur mêle le
 * dernier texel et le premier, que le repli sépare. `wrapUv` rend donc les deux prises et leur
 * poids — `proche` seule hors couture, puis `loin` et `poids` sur la couture, où l'appelant mêle
 * lui-même les quatre lectures. `proche` reste le texel que le repli désignait, donc une lecture au
 * plus proche ne bouge pas ; les deux prises tombent au centre exact d'un texel de bord, si bien que
 * la lecture ne dépend plus de l'interpolation de la carte mais du mélange que l'appelant écrit.
 *
 * Sans bit de répétition, aucune période ne reboucle et la couture ne peut pas être vraie :
 * `wrapReplie` rend alors la coordonnée seule, et l'appelant s'épargne de compter les texels.
 */
export const WRAP_COORD_WGSL = `${WRAP_OF_WGSL}
fn wrapCoord(t:f32,repeat:bool,mirror:bool)->f32{
 let p=t-2.0*floor(t*0.5);
 return select(select(clamp(t,0.0,1.0),fract(t),repeat),select(p,2.0-p,p>1.0),mirror);
}
struct WrapTaps{proche:vec2f,loin:vec2f,poids:vec2f,couture:bool,}
fn wrapRepete(wrap:u32)->bool{return (wrap&${WRAP_REPEATS}u)!=0u;}
fn wrapReplie(uv:vec2f,wrap:u32)->vec2f{
 return vec2f(wrapCoord(uv.x,false,(wrap&${WRAP_S_MIRROR}u)!=0u),wrapCoord(uv.y,false,(wrap&${WRAP_T_MIRROR}u)!=0u));
}
// Limite connue, non corrigée : le demi-texel est pris sur textureDimensions(maps_i,0), la période
// du niveau 0, alors que textureSampleGrad lit le niveau que le gradient choisit. Sous
// minification, la couture d'un niveau de mip lit donc encore le bord serré ; seule la
// magnification est corrigée. La lever ne se fait pas ici : il faut que le compilateur d'atlas pose,
// par niveau, une gouttière de texels de bord répliqués, pour que l'échantillonneur rende lui-même
// la couleur de la couture à tous les niveaux.
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
