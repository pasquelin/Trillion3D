import * as THREE from 'three';
import { sideOf } from './materialSide.ts';
import { physicalExtensionReason } from './physicalMaterialGate.ts';
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

/** Transmission/volume cannot be reconstructed from a visbuffer ID; keep the source mesh on the
 *  forward path. Read on the material itself: this runs per copy and per frame. */
export function isTransmissive(material: THREE.Material | THREE.Material[]) {
  const physical = (Array.isArray(material) ? material[0] : material) as
    THREE.MeshPhysicalMaterial | undefined;
  return !!physical?.isMeshPhysicalMaterial && physical.transmission > 0;
}

const textureReason = (texture: THREE.Texture | undefined) => {
  if (!texture) return;
  const typed = texture as THREE.Texture & {
    isCompressedTexture?: boolean;
    isDataTexture?: boolean;
    isDataArrayTexture?: boolean;
  };
  if (typed.isCompressedTexture || typed.isDataTexture || typed.isDataArrayTexture)
    return 'non-image texture storage is unsupported';
  if (!texture.image) return 'texture image is unavailable';
  if (texture.channel !== 0 && texture.channel !== 1)
    return `texture channel ${texture.channel} is unsupported`;
  if (texture.mapping !== THREE.UVMapping) return 'non-UV texture mapping is unsupported';
};

/**
 * Names material input the autonomous WebGL2 program cannot preserve before it submits a draw.
 * A transmissive physical material is accepted only where `transmissive` says the draw reads
 * the frozen backdrop: a paged cluster never does, a scene copy of the transmission pass does.
 */
export function clusterMaterialReason(
  material: THREE.Material | THREE.Material[],
  attributes: THREE.BufferGeometry['attributes'],
  transmissive = false,
) {
  if (Array.isArray(material)) return 'material arrays are unsupported';
  const standard = material as THREE.MeshStandardMaterial,
    basic = material as THREE.MeshBasicMaterial;
  if (!standard.isMeshStandardMaterial && !basic.isMeshBasicMaterial)
    return `material ${material.type} is unsupported`;
  if (
    material.alphaHash ||
    material.blending !== THREE.NormalBlending ||
    material.premultipliedAlpha ||
    material.alphaToCoverage ||
    material.clippingPlanes?.length
  )
    return `material ${material.type} uses an unsupported blend state`;
  const physical = physicalExtensionReason(standard as THREE.MeshPhysicalMaterial);
  if (physical) return physical;
  if (isTransmissive(material) !== transmissive)
    return transmissive
      ? 'a scene copy without transmission is not drawn by the transmission pass'
      : 'a transmissive material is drawn as a scene copy, not as a paged cluster';
  if (
    standard.envMap ||
    standard.lightMap ||
    standard.bumpMap ||
    standard.displacementMap ||
    standard.alphaMap ||
    standard.flatShading ||
    standard.wireframe ||
    material.stencilWrite
  )
    return `material ${material.type} uses an unsupported extension or raster state`;
  if (standard.normalMap && standard.normalMapType !== THREE.TangentSpaceNormalMap)
    return 'object-space normal mapping is unsupported';
  if (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile)
    return `material ${material.type} carries a shader hook`;
  if (!(attributes.position instanceof THREE.BufferAttribute))
    return 'position attribute is unsupported';
  const descriptor = visMaterial(material),
    basicAo = basic.isMeshBasicMaterial ? (basic.aoMap ?? undefined) : undefined,
    maps = [
      descriptor.map,
      descriptor.metalnessMap,
      descriptor.roughnessMap,
      descriptor.normalMap,
      descriptor.aoMap ?? basicAo,
      descriptor.emissiveMap,
    ];
  if (maps.some(Boolean) && !(attributes.uv instanceof THREE.BufferAttribute))
    return 'textured material has no UV attribute';
  if (
    maps.some((texture) => texture?.channel === 1) &&
    !(attributes.uv1 instanceof THREE.BufferAttribute)
  )
    return 'texture channel 1 has no UV1 attribute';
  if (standard.isMeshStandardMaterial && !(attributes.normal instanceof THREE.BufferAttribute))
    return 'lit material has no normal attribute';
  if (descriptor.normalMap && !(attributes.tangent instanceof THREE.BufferAttribute))
    return 'normal-mapped material has no tangent attribute';
  if (material.vertexColors && !(attributes.color instanceof THREE.BufferAttribute))
    return 'vertex-colour material has no color attribute';
  for (const texture of maps) {
    const reason = textureReason(texture);
    if (reason) return reason;
  }
}
