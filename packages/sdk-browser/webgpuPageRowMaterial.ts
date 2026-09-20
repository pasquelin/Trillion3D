import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { createPageRowConstants } from './webgpuPageRowConstants.ts';
import { materialClassKey } from './visibilityMaterialClass.ts';
import {
  FLAG_LIT,
  FLAG_DOUBLE,
  FLAG_HAS_UV,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_HAS_TANGENT,
  FLAG_MASK,
  FLAG_BACK,
  FLAG_HAS_ORM,
  FLAG_HAS_NORMAL_MAP,
  type VisMaterial,
} from './visibilityBuffer.ts';

export type GeometryBlock = {
  vertexBase: number;
  count: number;
  hasUv: boolean;
  hasNormal: boolean;
  hasTangent: boolean;
};
/** Atlas slots of a scene's textures, by texture; a texture the atlas does not hold reads slot 0. */
export type MaterialLayers = {
  mapLayer: ReadonlyMap<THREE.Texture, number>;
  dataLayer: ReadonlyMap<THREE.Texture, number>;
};

/** What a page row says of its material: its map slots, its flags word, and its resolve class. */
export function rowMaterial(
  mat: VisMaterial,
  geo: GeometryBlock | undefined,
  { mapLayer, dataLayer }: MaterialLayers,
) {
  const slot = (layers: ReadonlyMap<THREE.Texture, number>, texture?: THREE.Texture) =>
    texture ? (layers.get(texture) ?? 0) : 0;
  const map = slot(mapLayer, mat.map),
    rough = slot(dataLayer, mat.roughnessMap),
    metal = slot(dataLayer, mat.metalnessMap),
    normal = slot(dataLayer, mat.normalMap),
    ao = slot(dataLayer, mat.aoMap),
    emissive = slot(mapLayer, mat.emissiveMap);
  let flags = 0;
  if (mat.lit) flags |= FLAG_LIT;
  if (mat.doubleSided) flags |= FLAG_DOUBLE;
  if (geo?.hasUv) flags |= FLAG_HAS_UV;
  if (map) flags |= FLAG_HAS_MAP;
  if (geo?.hasNormal) flags |= FLAG_HAS_NORMAL;
  if (geo?.hasTangent) flags |= FLAG_HAS_TANGENT;
  if (mat.alphaTest > 0) flags |= FLAG_MASK;
  if (mat.backSide) flags |= FLAG_BACK;
  if (rough || metal) flags |= FLAG_HAS_ORM;
  if (normal) flags |= FLAG_HAS_NORMAL_MAP;
  const classKey = materialClassKey(flags, { rough, metal, ao, emissive, normal });
  return { map, rough, metal, normal, ao, emissive, flags, classKey };
}

/**
 * Resolve classes of a scene, sorted: every page's class, from the same material fields, geometry
 * block and atlas slots its row will carry. Known once the atlases are laid out, before any image:
 * the class pipelines are compiled here, never on the frame that first draws one.
 */
export function sceneMaterialClasses(
  allPages: readonly PageRec[],
  geometryBlocks: ReadonlyMap<THREE.BufferGeometry['attributes'], GeometryBlock>,
  layers: MaterialLayers,
) {
  const constants = createPageRowConstants();
  const keys = new Set<number>();
  for (const rec of allPages)
    keys.add(
      rowMaterial(
        constants.materialOf(rec.material).mat,
        geometryBlocks.get(rec.attributes),
        layers,
      ).classKey,
    );
  return [...keys].sort((a, b) => a - b);
}
