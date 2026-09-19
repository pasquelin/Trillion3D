import * as THREE from 'three';

/** Which faces of a surface are drawn — `front`, `back` or `double`, what the host declares as
 *  `THREE.FrontSide`, `THREE.BackSide` or `THREE.DoubleSide`: the engine's own enum, compared
 *  everywhere downstream. */
export type Side = 'front' | 'back' | 'double';

/** The host side constant a material declares, the first of an array deciding; an empty
 *  array declares nothing and gets the host default, front, instead of a crash. */
export function materialSide(material: THREE.Material | THREE.Material[]): THREE.Side {
  return Array.isArray(material) ? (material[0]?.side ?? THREE.FrontSide) : material.side;
}

/**
 * The side a host material declares, read once at the boundary. The only place that
 * names the host library's side constants: the raster, the cones, the pipelines and the
 * blend plan compare against `Side`, never against them.
 */
export function sideOf(material: THREE.Material | THREE.Material[]): Side {
  const side = materialSide(material);
  return side === THREE.DoubleSide ? 'double' : side === THREE.BackSide ? 'back' : 'front';
}
