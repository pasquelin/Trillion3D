import { PHYSICAL_MAP_FIELDS, PHYSICAL_MAP_UNIT } from './physicalMaps.ts';
import { visMaterial } from '../../visibility/shader/material.ts';
import { readsOcclusion } from '../../scene/surfaceModel.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import type { HostShadedMaterial } from '../../host/shadedMaterial.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { ClusterDrawMesh } from '../../cluster/batchMesh.ts';

export type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;

/** The program's map units, in order, and the UV matrix uniform each reads. */
const MAPS = [
  'map',
  'roughnessMap',
  'metalnessMap',
  'normalMap',
  'aoMap',
  'emissiveMap',
  'subsurfaceMap',
] as const;
export const SUBSURFACE_UNIT = 14;
export const MAP_UNIFORMS = ['baseUv', 'roughUv', 'metalUv', 'normalUv', 'aoUv', 'emissiveUv'];
MAP_UNIFORMS[SUBSURFACE_UNIT] = 'subsurfaceUv';

/** What a unit binds: the material's map, the texture bound for it (none: the fallback texel, or
 *  a map another unit binds), its encoding, its fallback texel, and whether the map's alpha has
 *  coverage readers (a base or emissive map, #42). */
type MapVisit = (
  unit: number,
  map: Texture | undefined,
  texture: Texture | undefined,
  srgb: boolean,
  fallback: readonly number[] | undefined,
  reader: boolean,
) => void;

/**
 * THE MAPS A MATERIAL BINDS, unit by unit, as the draw binds them (`materialBinding.ts`) and as
 * the census orders them to upload ahead of the draws (`textureQueue.ts`): one walk, so both
 * upload the same textures under the same keys. An unlit material keeps its occlusion map on the
 * host object alone: it is imported here, as the boundary imports every other; only a plain
 * colour one reads it (`readsOcclusion`). A roughness and metalness read from one channel of one map bind it once.
 * Returns the material's engine record, its occlusion map and whether the two maps are shared.
 */
export function eachMap(material: Material, visit: MapVisit, physical = false) {
  const mat = visMaterial(material),
    basic = material as HostShadedMaterial,
    aoMap =
      mat.aoMap ??
      (basic.aoMap && readsOcclusion(basic) ? importHostTexture(basic.aoMap) : undefined);
  const sharedMetalRough =
    !!mat.roughnessMap &&
    mat.roughnessMap === mat.metalnessMap &&
    mat.roughnessMap.channel === mat.metalnessMap.channel;
  for (let index = 0; index < MAPS.length; index++) {
    const unit = index === 6 ? SUBSURFACE_UNIT : index;
    const texture = MAPS[index] === 'aoMap' ? aoMap : mat[MAPS[index]];
    visit(
      unit,
      texture,
      sharedMetalRough && unit === 2 ? undefined : texture,
      texture?.colorSpace === 'srgb',
      unit === 3 ? [128, 128, 255, 255] : undefined,
      MAPS[index] === 'map' || MAPS[index] === 'emissiveMap',
    );
  }
  if (physical)
    for (const field of PHYSICAL_MAP_FIELDS) {
      const map = mat[field];
      visit(PHYSICAL_MAP_UNIT, map, map, false, undefined, false);
    }
  return { mat, aoMap, sharedMetalRough };
}
