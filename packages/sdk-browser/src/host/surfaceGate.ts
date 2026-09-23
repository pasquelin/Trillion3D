/**
 * Admission gate of a host surface, read once at import and never on a frame.
 *
 * It names what the autonomous programs cannot preserve before they submit a draw — a shader hook,
 * an unsupported blend state, a map the engine has no slot for, an attribute the pages cannot
 * carry. Every check is about the host declaration itself, read through the shapes of
 * `shadedMaterial.ts` and the named constants of `surfaceConstants.ts`; what the engine
 * computes with afterwards is the imported record of `surfaceImport.ts`.
 */

import type { HostAttribute, HostAttributes, HostMaterials } from './resources.ts';
import type { HostMap, HostShadedMaterial, HostStoredTexture } from './shadedMaterial.ts';
import {
  HOST_BLENDING_NORMAL,
  HOST_MAPPING_UV,
  HOST_NORMAL_MAP_TANGENT_SPACE,
} from './surfaceConstants.ts';
import { declaresCompileHook } from './materialHook.ts';
import { physicalExtensionReason } from '../scene/physicalMaterialGate.ts';
import { isTransmissive } from '../visibility/shader/material.ts';

const textureReason = (source: HostMap) => {
  if (!source) return;
  const texture = source as HostStoredTexture;
  if (texture.isCompressedTexture || texture.isDataTexture || texture.isDataArrayTexture)
    return 'non-image texture storage is unsupported';
  if (!texture.image) return 'texture image is unavailable';
  if (texture.channel !== 0 && texture.channel !== 1)
    return `texture channel ${texture.channel} is unsupported`;
  if (texture.mapping !== HOST_MAPPING_UV) return 'non-UV texture mapping is unsupported';
};

/** An attribute the autonomous programs can bind on its own: the host declares it as a buffer of
 *  its own, not as one view interleaved into a shared one. */
const ownBuffer = (attribute: HostAttribute | undefined) => !!attribute?.isBufferAttribute;

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
  const host = material as HostShadedMaterial;
  if (!host.isMeshStandardMaterial && !host.isMeshBasicMaterial)
    return `material ${host.type} is unsupported`;
  if (
    host.alphaHash ||
    host.blending !== HOST_BLENDING_NORMAL ||
    host.premultipliedAlpha ||
    host.alphaToCoverage ||
    host.clippingPlanes?.length
  )
    return `material ${host.type} uses an unsupported blend state`;
  const physical = physicalExtensionReason(host);
  if (physical) return physical;
  if (!transmissive && isTransmissive(material))
    return 'a transmissive material is drawn as a scene copy, not as a paged cluster';
  if (
    host.envMap ||
    host.lightMap ||
    host.bumpMap ||
    host.displacementMap ||
    host.alphaMap ||
    host.flatShading ||
    host.wireframe ||
    host.stencilWrite
  )
    return `material ${host.type} uses an unsupported extension or raster state`;
  if (host.normalMap && host.normalMapType !== HOST_NORMAL_MAP_TANGENT_SPACE)
    return 'object-space normal mapping is unsupported';
  if (declaresCompileHook(host)) return `material ${host.type} carries a shader hook`;
  if (!ownBuffer(attributes.position)) return 'position attribute is unsupported';
  // The same six maps the import reads, in the same order: a basic material declares none of the
  // lit ones, so the list is the host's own properties, not a second rule.
  const maps = [
    host.map,
    host.metalnessMap,
    host.roughnessMap,
    host.normalMap,
    host.aoMap,
    host.emissiveMap,
  ];
  if (maps.some(Boolean) && !ownBuffer(attributes.uv))
    return 'textured material has no UV attribute';
  if (maps.some((texture) => texture?.channel === 1) && !ownBuffer(attributes.uv1))
    return 'texture channel 1 has no UV1 attribute';
  if (host.isMeshStandardMaterial && !ownBuffer(attributes.normal))
    return 'lit material has no normal attribute';
  if (host.vertexColors && !ownBuffer(attributes.color))
    return 'vertex-colour material has no color attribute';
  for (const texture of maps) {
    const reason = textureReason(texture);
    if (reason) return reason;
  }
}
