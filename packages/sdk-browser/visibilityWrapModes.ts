import * as THREE from 'three';
import type { VisMaterial } from './visibilityTypes.ts';

/**
 * Le mode d'adressage d'une carte, un quartet de bits par carte, six cartes dans un seul mot.
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

/** Rang de chaque carte dans le mot : quatre bits chacune, vingt-quatre bits employés sur trente-deux. */
export const WRAP_MAP = {
  base: 0,
  rough: 1,
  metal: 2,
  normal: 3,
  ao: 4,
  emissive: 5,
} as const;

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

/**
 * Le mot d'adressage d'un matériau : le quartet de chacune de ses cartes à son rang. Écrit par
 * `webgpuPageRow.ts` dans la fiche de page et par `webgpuBlendPrepare.ts` dans l'uniforme d'un lot
 * transparent — une page et un lot transparent portant des mots différents adresseraient les mêmes
 * textures de deux façons.
 */
export function wrapModes(mat: VisMaterial) {
  return (
    (wrapNibble(mat.map) << (4 * WRAP_MAP.base)) |
    (wrapNibble(mat.roughnessMap) << (4 * WRAP_MAP.rough)) |
    (wrapNibble(mat.metalnessMap) << (4 * WRAP_MAP.metal)) |
    (wrapNibble(mat.normalMap) << (4 * WRAP_MAP.normal)) |
    (wrapNibble(mat.aoMap) << (4 * WRAP_MAP.ao)) |
    (wrapNibble(mat.emissiveMap) << (4 * WRAP_MAP.emissive))
  );
}

/** Miroir processeur de `wrapOf` (WGSL) : le quartet de la carte `map` dans le mot. */
export const wrapOf = (modes: number, map: number) => (modes >>> (4 * map)) & 15;

/** `wrapOf` tel que le nuanceur le lit, déclaré une fois avec la règle d'adressage qui l'emploie. */
export const WRAP_OF_WGSL = `fn wrapOf(modes:u32,map:u32)->u32{return (modes>>(map*4u))&15u;}`;
