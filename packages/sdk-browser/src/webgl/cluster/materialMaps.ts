import { visMaterial } from '../../visibility/shader/material.ts';
import { readsOcclusion } from '../../scene/surfaceModel.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import type { HostShadedMaterial } from '../../host/shadedMaterial.ts';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { ClusterDrawMesh } from '../../cluster/batchMesh.ts';

export type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;

/** The program's map units, in order, and the UV matrix uniform each reads. */
const MAPS = ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'emissiveMap'] as const;
export const MAP_UNIFORMS = ['baseUv', 'roughUv', 'metalUv', 'normalUv', 'aoUv', 'emissiveUv'];

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
 * the census uploads them ahead of any draw (`texturePrime.ts`): one walk, so both upload the same
 * textures under the same keys. An unlit material keeps its occlusion map on the host object
 * alone: it is imported here, as the boundary imports every other; only a plain colour one reads
 * it (`readsOcclusion`). A roughness and metalness read from one channel of one map bind it once.
 * Returns the material's engine record, its occlusion map and whether the two maps are shared.
 */
export function eachMap(material: Material, visit: MapVisit) {
  const mat = visMaterial(material),
    basic = material as HostShadedMaterial,
    aoMap =
      mat.aoMap ??
      (basic.aoMap && readsOcclusion(basic) ? importHostTexture(basic.aoMap) : undefined);
  const sharedMetalRough =
    !!mat.roughnessMap &&
    mat.roughnessMap === mat.metalnessMap &&
    mat.roughnessMap.channel === mat.metalnessMap.channel;
  for (let unit = 0; unit < MAPS.length; unit++) {
    const texture = MAPS[unit] === 'aoMap' ? aoMap : mat[MAPS[unit]];
    visit(
      unit,
      texture,
      sharedMetalRough && unit === 2 ? undefined : texture,
      texture?.colorSpace === 'srgb',
      unit === 3 ? [128, 128, 255, 255] : undefined,
      MAPS[unit] === 'map' || MAPS[unit] === 'emissiveMap',
    );
  }
  return { mat, aoMap, sharedMetalRough };
}
