import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { visMaterial } from './visibilityBuffer.ts';

/** Finds each color and data texture once, keeping stable atlas layer order. */
export function collectWebgpuMaterialTextures(
  allPages: PageRec[],
  blendCopies: THREE.Mesh[],
  mapLayer: Map<THREE.Texture, number>,
  dataLayer: Map<THREE.Texture, number>,
) {
  const maps: THREE.Texture[] = [];
  const dataMaps: THREE.Texture[] = [];
  const normalMaps = new Set<THREE.Texture>();
  const addColor = (texture?: THREE.Texture) => {
    if (texture && !mapLayer.has(texture)) {
      mapLayer.set(texture, maps.length + 1);
      maps.push(texture);
    }
  };
  const addData = (texture?: THREE.Texture) => {
    if (texture && !dataLayer.has(texture)) {
      dataLayer.set(texture, dataMaps.length + 1);
      dataMaps.push(texture);
    }
  };
  const collect = (material: THREE.Material | THREE.Material[]) => {
    const mat = visMaterial(material);
    addColor(mat.map);
    addColor(mat.emissiveMap);
    addData(mat.roughnessMap);
    addData(mat.metalnessMap);
    addData(mat.normalMap);
    if (mat.normalMap) normalMaps.add(mat.normalMap);
    addData(mat.aoMap);
  };
  for (const rec of allPages) collect(rec.material);
  for (const copy of blendCopies) collect(copy.material);
  return { maps, dataMaps, normalMaps };
}
