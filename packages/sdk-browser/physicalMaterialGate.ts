/**
 * What the autonomous WebGL2 program accepts of a physical material: the glTF transmission
 * volume — `KHR_materials_transmission`, `KHR_materials_ior`, `KHR_materials_volume` as
 * factors — and nothing else. Every other physical extension is named here before a draw,
 * so a surface never loses a declared feature silently.
 */
type PhysicalLike = {
  isMeshPhysicalMaterial?: boolean;
  transmission?: number;
  ior?: number;
  transmissionMap?: unknown;
  thicknessMap?: unknown;
  clearcoat?: number;
  clearcoatMap?: unknown;
  clearcoatRoughnessMap?: unknown;
  clearcoatNormalMap?: unknown;
  sheen?: number;
  sheenColorMap?: unknown;
  sheenRoughnessMap?: unknown;
  iridescence?: number;
  iridescenceMap?: unknown;
  iridescenceThicknessMap?: unknown;
  anisotropy?: number;
  anisotropyMap?: unknown;
  dispersion?: number;
  specularIntensity?: number;
  specularIntensityMap?: unknown;
  specularColorMap?: unknown;
  specularColor?: { r: number; g: number; b: number };
};

const EXTENSION_FACTORS = [
  'clearcoat',
  'sheen',
  'iridescence',
  'anisotropy',
  'dispersion',
] as const;
const EXTENSION_MAPS = [
  'transmissionMap',
  'thicknessMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
  'specularIntensityMap',
  'specularColorMap',
] as const;

/** Names the physical extension a material uses beyond the transmission volume, if any. The
 *  IOR shapes the Fresnel of the transmission pass alone: without transmission, the cluster
 *  BRDF would keep its dielectric F0 and the declared IOR would be lost in silence. */
export function physicalExtensionReason(material: PhysicalLike) {
  if (!material.isMeshPhysicalMaterial) return;
  if ((material.ior ?? 1.5) !== 1.5 && !((material.transmission ?? 0) > 0))
    return 'physical ior without transmission is unsupported';
  for (const factor of EXTENSION_FACTORS)
    if ((material[factor] ?? 0) !== 0) return `physical ${factor} is unsupported`;
  for (const map of EXTENSION_MAPS) if (material[map]) return `physical ${map} is unsupported`;
  const specular = material.specularColor;
  if (
    (material.specularIntensity ?? 1) !== 1 ||
    (specular && (specular.r !== 1 || specular.g !== 1 || specular.b !== 1))
  )
    return 'physical specular factor is unsupported';
}
