import * as THREE from 'three';
import { sideOf } from './materialSide.ts';
import type { VisMaterial } from './visibilityTypes.ts';

const WHITE: [number, number, number] = [1, 1, 1];
const BLACK: [number, number, number] = [0, 0, 0];

/**
 * Host defaults for an empty material declaration (`material: []`): white, opaque, front, unlit.
 * Shared across empty declarations so per-frame readers avoid allocating on the main path.
 */
const DEFAULT_VIS_MATERIAL: VisMaterial = Object.freeze({
  baseColor: WHITE,
  metalness: 0,
  roughness: 1,
  lit: false,
  doubleSided: false,
  backSide: false,
  alphaTest: 0,
  normalScale: 1,
  normalScaleY: 1,
  aoIntensity: 1,
  emissive: BLACK,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationDistance: 0,
  attenuationColor: WHITE,
});

export function visMaterial(material: THREE.Material | THREE.Material[]): VisMaterial {
  const first = Array.isArray(material) ? material[0] : material;
  if (!first) return DEFAULT_VIS_MATERIAL;
  const color =
    'color' in first && first.color instanceof THREE.Color ? first.color : new THREE.Color(1, 1, 1);
  const std = first as THREE.MeshStandardMaterial;
  const phys = first as THREE.MeshPhysicalMaterial;
  const lit = !!std.isMeshStandardMaterial,
    side = sideOf(first);
  return {
    baseColor: [color.r, color.g, color.b],
    metalness: lit ? std.metalness : 0,
    roughness: lit ? std.roughness : 1,
    lit,
    doubleSided: side === 'double',
    backSide: side === 'back',
    alphaTest: 'alphaTest' in first && typeof first.alphaTest === 'number' ? first.alphaTest : 0,
    map: 'map' in first && first.map ? (first.map as THREE.Texture) : undefined,
    metalnessMap: lit && std.metalnessMap ? std.metalnessMap : undefined,
    roughnessMap: lit && std.roughnessMap ? std.roughnessMap : undefined,
    normalMap: lit && std.normalMap ? std.normalMap : undefined,
    normalScale: lit && std.normalScale ? std.normalScale.x : 1,
    normalScaleY: lit && std.normalScale ? std.normalScale.y : 1,
    aoMap: lit && std.aoMap ? std.aoMap : undefined,
    aoIntensity: lit ? std.aoMapIntensity : 1,
    emissive: lit
      ? [
          std.emissive.r * std.emissiveIntensity,
          std.emissive.g * std.emissiveIntensity,
          std.emissive.b * std.emissiveIntensity,
        ]
      : [0, 0, 0],
    emissiveMap: lit && std.emissiveMap ? std.emissiveMap : undefined,
    transmission:
      phys.isMeshPhysicalMaterial && typeof phys.transmission === 'number' ? phys.transmission : 0,
    ior: phys.isMeshPhysicalMaterial && typeof phys.ior === 'number' ? phys.ior : 1.5,
    thickness:
      phys.isMeshPhysicalMaterial && typeof phys.thickness === 'number' ? phys.thickness : 0,
    // Three yields `Infinity` when the glTF does not declare a distance; zero says “no attenuation”
    // without shipping an infinity as far as a uniform.
    attenuationDistance:
      phys.isMeshPhysicalMaterial && Number.isFinite(phys.attenuationDistance)
        ? phys.attenuationDistance
        : 0,
    attenuationColor:
      phys.isMeshPhysicalMaterial && phys.attenuationColor
        ? [phys.attenuationColor.r, phys.attenuationColor.g, phys.attenuationColor.b]
        : [1, 1, 1],
  };
}

/** Transmission/volume cannot be reconstructed from a visbuffer ID; keep the source mesh on the forward path. */
export function isTransmissive(material: THREE.Material | THREE.Material[]) {
  return visMaterial(material).transmission > 0;
}
