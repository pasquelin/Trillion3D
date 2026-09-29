/**
 * What the autonomous WebGL2 program draws of a physical material: the glTF transmission
 * volume — `KHR_materials_transmission`, `KHR_materials_ior`, `KHR_materials_volume` as
 * factors — plus anisotropy and clearcoat with their maps. Other physical extensions are named before a draw: the
 * surface is drawn without it and the world says so by name (`noticeMaterialDegraded`), so a
 * surface never loses a declared feature silently and never stops the loop.
 */
import type { HostShadedMaterial } from '../host/shadedMaterial.ts';

/** The physical material as this gate reads it: what `../host/shadedMaterial.ts` already declares of
 *  a shaded surface, plus the extension slots only this gate ever looks at. Declared here and not
 *  there because nothing else in the engine reads them — they exist to be named in a notice. */
type PhysicalLike = HostShadedMaterial & {
  readonly transmissionMap?: unknown;
  readonly thicknessMap?: unknown;
  readonly clearcoat?: number;
  readonly clearcoatMap?: unknown;
  readonly clearcoatRoughnessMap?: unknown;
  readonly clearcoatNormalMap?: unknown;
  readonly sheen?: number;
  readonly sheenColorMap?: unknown;
  readonly sheenRoughnessMap?: unknown;
  readonly iridescence?: number;
  readonly iridescenceMap?: unknown;
  readonly iridescenceThicknessMap?: unknown;
  readonly anisotropy?: number;
  readonly anisotropyMap?: unknown;
  readonly dispersion?: number;
  readonly specularIntensity?: number;
  readonly specularIntensityMap?: unknown;
  readonly specularColorMap?: unknown;
  readonly specularColor?: { readonly r: number; readonly g: number; readonly b: number };
};

const EXTENSION_FACTORS = ['sheen', 'iridescence', 'dispersion'] as const;
const EXTENSION_MAPS = [
  'transmissionMap',
  'thicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'specularIntensityMap',
  'specularColorMap',
] as const;

/** Every feature the gate names, in the order a notice lists them: its rank is its bit. */
const EXTENSIONS = [...EXTENSION_FACTORS, ...EXTENSION_MAPS] as const;
const FEATURES = ['ior', ...EXTENSIONS, 'specular'] as const;

/** The features a material declares beyond the transmission volume, one bit each by their rank
 *  in `FEATURES`, 0 when it declares none: read on every draw without allocating, so a field
 *  set on a live surface without `needsUpdate` is read too. The IOR shapes the Fresnel of the
 *  transmission pass alone: without transmission, the cluster BRDF keeps its dielectric F0, so
 *  the declared IOR is one of them. */
export function physicalLostMask(material: PhysicalLike) {
  if (material.family !== 'physical') return 0;
  let mask = (material.ior ?? 1.5) !== 1.5 && !((material.transmission ?? 0) > 0) ? 1 : 0,
    bit = 2;
  for (const key of EXTENSIONS) {
    if (material[key]) mask |= bit;
    bit <<= 1;
  }
  const specular = material.specularColor;
  if (
    (material.specularIntensity ?? 1) !== 1 ||
    (specular && (specular.r !== 1 || specular.g !== 1 || specular.b !== 1))
  )
    mask |= bit;
  return mask;
}

/** The names of the features `mask` holds (`physicalLostMask`). */
export const featuresOf = (mask: number) => FEATURES.filter((_, rank) => mask & (1 << rank));
