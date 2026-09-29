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
import type { HostMap, HostShadedMaterial } from './shadedMaterial.ts';
import { blendingOf, blendingRefusal } from '../scene/materialBlending.ts';
import { readsOcclusion, unreadMapRefusal } from '../scene/surfaceModel.ts';
import { HOST_MAPPING_UV, HOST_NORMAL_MAP_TANGENT_SPACE } from './surfaceConstants.ts';
import { texelsReason } from '../visibility/types.ts';
import { declaresCompileHook } from './materialHook.ts';
import { isTransmissive } from '../visibility/shader/material.ts';

const textureReason = (texture: HostMap) => {
  if (!texture) return;
  if (!texture.image) return 'texture image is unavailable';
  const texels = texture.kind === 'texels' && texelsReason(texture);
  if (texels) return texels;
  if (texture.channel !== 0 && texture.channel !== 1)
    return `texture channel ${texture.channel} is unsupported`;
  if (texture.mapping !== HOST_MAPPING_UV) return 'non-UV texture mapping is unsupported';
};

/** An attribute the autonomous programs can bind on its own: the host declares it as a buffer of
 *  its own, not as one view interleaved into a shared one. */
const ownBuffer = (attribute: HostAttribute | undefined) => attribute?.kind === 'attribute';

/** The six maps the import reads, in its order: a basic material declares none of the lit ones,
 *  so the list is the host's own properties, not a second rule. An occlusion map its model
 *  ignores asks for no UV. */
const MAP_KEYS = [
  'map',
  'metalnessMap',
  'roughnessMap',
  'normalMap',
  'aoMap',
  'emissiveMap',
] as const;
const mapOf = (host: HostShadedMaterial, key: (typeof MAP_KEYS)[number]) =>
  key === 'aoMap' && !readsOcclusion(host) ? undefined : host[key];

/** The maps `host` reads on UV `channel`, or on any channel: counted by walking its properties,
 *  so the gate of a page allocates nothing (#840: read for every page of a frame). */
function readMaps(host: HostShadedMaterial, channel?: number) {
  let count = 0;
  for (const key of MAP_KEYS) {
    const texture = mapOf(host, key);
    if (texture && (channel === undefined || texture.channel === channel)) count++;
  }
  return count;
}

/**
 * What a surface answers alone, in the gate's order: the reason read before its attributes, and
 * the one read after them (its maps' pictures). `clusterMaterialReason` reads the three parts; a
 * frame that draws many pages of one surface reads its two parts once (`../webgl/cluster/
 * validation.ts`).
 */
export function surfaceReasons(material: HostMaterials, transmissive = false) {
  if (Array.isArray(material)) return ['material arrays are unsupported', undefined] as const;
  const host = material as HostShadedMaterial;
  return [surfaceReason(host, transmissive), mapsReason(host)] as const;
}

function surfaceReason(host: HostShadedMaterial, transmissive: boolean) {
  // The draws' own refusal (`drawnBlending`): a mode admitted here is one every path draws.
  const refusal = blendingRefusal(blendingOf(host.blending), isTransmissive(host));
  if (refusal) return `material ${host.family}: ${refusal} (blending ${host.blending})`;
  if (
    host.alphaHash ||
    host.premultipliedAlpha ||
    host.alphaToCoverage ||
    host.clippingPlanes?.length
  )
    return `material ${host.family} uses an unsupported blend state`;
  if (!transmissive && isTransmissive(host))
    return 'a transmissive material is drawn as a scene copy, not as a paged cluster';
  if (
    host.envMap ||
    host.lightMap ||
    host.bumpMap ||
    host.displacementMap ||
    host.alphaMap ||
    host.wireframe ||
    host.stencilWrite
  )
    return `material ${host.family} uses an unsupported extension or raster state`;
  const unread = unreadMapRefusal(host);
  if (unread) return unread;
  if (host.normalMap && host.normalMapType !== HOST_NORMAL_MAP_TANGENT_SPACE)
    return 'object-space normal mapping is unsupported';
  if (declaresCompileHook(host)) return `material ${host.family} carries a shader hook`;
}

/** What the attributes of one mesh wearing `material` lack. */
export function attributeReason(material: HostMaterials, attributes: HostAttributes) {
  const host = material as HostShadedMaterial;
  if (!ownBuffer(attributes.position)) return 'position attribute is unsupported';
  if (readMaps(host) && !ownBuffer(attributes.uv)) return 'textured material has no UV attribute';
  if (readMaps(host, 1) && !ownBuffer(attributes.uv1))
    return 'texture channel 1 has no UV1 attribute';
  // Every family but the plain colour and the depth ramp shades by the normal: the lit ones, the
  // normal view, and the matcap, which reads its image by it.
  if (host.family !== 'basic' && host.family !== 'depth' && !ownBuffer(attributes.normal))
    return `material ${host.family} has no normal attribute`;
  if (host.vertexColors && !ownBuffer(attributes.color))
    return 'vertex-colour material has no color attribute';
}

function mapsReason(host: HostShadedMaterial) {
  for (const key of MAP_KEYS) {
    const reason = textureReason(mapOf(host, key));
    if (reason) return reason;
  }
  // A matcap's image is read at its normal's coordinate, never by a UV attribute.
  return textureReason(host.matcap);
}

/**
 * Names material input the autonomous WebGL2 program cannot preserve before it submits a draw.
 * A physical extension is not one: it is drawn without, by name (`physicalFeaturesLost`).
 * A transmissive physical material is accepted only where `transmissive` says the draw reads
 * the frozen backdrop: a scene copy of the transmission pass does, a paged cluster never does.
 */
export function clusterMaterialReason(
  material: HostMaterials,
  attributes: HostAttributes,
  transmissive = false,
) {
  const [before, after] = surfaceReasons(material, transmissive);
  return before ?? attributeReason(material, attributes) ?? after;
}
