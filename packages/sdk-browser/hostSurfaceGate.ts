/**
 * Admission gate of a host surface, read once at import and never on a frame.
 *
 * It names what the autonomous programs cannot preserve before they submit a draw — a shader hook,
 * an unsupported blend state, a map the engine has no slot for, an attribute the pages cannot
 * carry. Every check is about the host declaration itself, so this is where the host rendering
 * library is still named; what the engine computes with afterwards is the imported record of
 * `hostSurfaceImport.ts`.
 */

import * as THREE from 'three';
import { asHostLibrary, type HostAttributes, type HostMaterials } from './hostResources.ts';
import { physicalExtensionReason } from './physicalMaterialGate.ts';
import { isTransmissive } from './visibilityMaterial.ts';

type StoredTexture = THREE.Texture & {
  isCompressedTexture?: boolean;
  isDataTexture?: boolean;
  isDataArrayTexture?: boolean;
};

const textureReason = (source: THREE.Texture | null | undefined) => {
  if (!source) return;
  const texture = source as StoredTexture;
  if (texture.isCompressedTexture || texture.isDataTexture || texture.isDataArrayTexture)
    return 'non-image texture storage is unsupported';
  if (!texture.image) return 'texture image is unavailable';
  if (texture.channel !== 0 && texture.channel !== 1)
    return `texture channel ${texture.channel} is unsupported`;
  if (texture.mapping !== THREE.UVMapping) return 'non-UV texture mapping is unsupported';
};

/**
 * Names material input the autonomous WebGL2 program cannot preserve before it submits a draw.
 * A transmissive physical material is accepted only where `transmissive` says the draw reads
 * the frozen backdrop: a scene copy of the transmission pass does, a paged cluster never does.
 */
export function clusterMaterialReason(
  material: HostMaterials,
  attributes: HostAttributes,
  transmissive = false,
) {
  if (Array.isArray(material)) return 'material arrays are unsupported';
  const host = asHostLibrary<THREE.Material>(material),
    standard = host as THREE.MeshStandardMaterial,
    basic = host as THREE.MeshBasicMaterial;
  if (!standard.isMeshStandardMaterial && !basic.isMeshBasicMaterial)
    return `material ${host.type} is unsupported`;
  if (
    host.alphaHash ||
    host.blending !== THREE.NormalBlending ||
    host.premultipliedAlpha ||
    host.alphaToCoverage ||
    host.clippingPlanes?.length
  )
    return `material ${host.type} uses an unsupported blend state`;
  const physical = physicalExtensionReason(standard as THREE.MeshPhysicalMaterial);
  if (physical) return physical;
  if (!transmissive && isTransmissive(material))
    return 'a transmissive material is drawn as a scene copy, not as a paged cluster';
  if (
    standard.envMap ||
    standard.lightMap ||
    standard.bumpMap ||
    standard.displacementMap ||
    standard.alphaMap ||
    standard.flatShading ||
    standard.wireframe ||
    host.stencilWrite
  )
    return `material ${host.type} uses an unsupported extension or raster state`;
  if (standard.normalMap && standard.normalMapType !== THREE.TangentSpaceNormalMap)
    return 'object-space normal mapping is unsupported';
  if (host.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile)
    return `material ${host.type} carries a shader hook`;
  if (!(attributes.position instanceof THREE.BufferAttribute))
    return 'position attribute is unsupported';
  // The same six maps the import reads, in the same order: a basic material declares none of the
  // lit ones, so the list is the host's own properties, not a second rule.
  const maps = [
    standard.map,
    standard.metalnessMap,
    standard.roughnessMap,
    standard.normalMap,
    standard.aoMap,
    standard.emissiveMap,
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
  if (standard.vertexColors && !(attributes.color instanceof THREE.BufferAttribute))
    return 'vertex-colour material has no color attribute';
  for (const texture of maps) {
    const reason = textureReason(texture);
    if (reason) return reason;
  }
}
